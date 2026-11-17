import { randomBytes, randomInt } from 'node:crypto';
import {
  ACADEMIES,
  actingSeats,
  allSubmitted,
  archmagePick,
  botPick,
  createGame,
  finalScores,
  legalActions,
  resolveTurn,
  submitAction,
  viewFor,
  winners,
} from '@arcane/engine';
import type { Action, BotLevel, GameState, SeatConfig } from '@arcane/engine';
import {
  DEFAULT_ROOM_CONFIG,
  DEFAULT_SETTINGS,
  PLAY_AGAIN_MS,
  ROOM_SEATS,
  REACTION_BURST,
  REACTION_REFILL_MS,
  SETTINGS_LIMITS,
  type Avatar,
  type ClientMessage,
  type CloseReason,
  type ErrorCode,
  type GameReveal,
  type LobbyState,
  type OpenRoom,
  type Queue,
  type RoomConfig,
  type Side,
  type ReactionId,
  type RoomSettings,
  type SeatId,
  type SeatStatus,
  type ServerMessage,
} from '@arcane/protocol';
import type { Clock } from './clock';
import type { GameRecord } from './store';

/** One client connection, whatever the transport. */
export interface Conn {
  send(msg: ServerMessage): void;
  close(reason: CloseReason): void;
}

export interface RoomOptions {
  /** Base URL of the web client; invite links are `${clientUrl}/?room=CODE`. */
  clientUrl: string;
  /** Server-side defaults. May go outside the host's limits (useful for tests and local play). */
  defaultSettings?: Partial<RoomSettings>;
  seed?: () => number;
  /** The account (user id) logged in on this connection, if any. Its seat's result is recorded. */
  accountOf?(conn: Conn): string | null;
  /** The username logged in on this connection, if any; shown on its seat. */
  usernameOf?(conn: Conn): string | null;
  /** True when the account on `viewer` blocked `accountId`: that account's reactions are not sent to it. */
  hidesFrom?(viewer: Conn, accountId: string): boolean;
  /** The avatar of the account logged in on this connection (null: guest or default). */
  avatarOf?(conn: Conn): Avatar | null;
  /** Called once per finished game with one record per account seated in it. */
  onResults?(records: GameRecord[]): void;
}

/** What made a room and how it is set up. */
export interface RoomSetup {
  kind: 'casual' | 'ranked' | 'room';
  queue?: Queue;
  /** Host rooms: the creator's choices (validated by the caller with checkConfig). */
  config?: RoomConfig;
  /** Called after anything a room list shows may have changed (lobby updates, start, close). */
  onChange?(): void;
}

/** Why this setup is not allowed with `humans` players already seated, or null when fine. */
export function checkConfig(c: RoomConfig, humans: number): string | null {
  const [lo, hi] = ROOM_SEATS;
  if (c.seats < lo || c.seats > hi) return 'A room has 2 to 7 seats';
  if (c.bots < 0 || c.bots > c.seats - 1) return 'Bots must leave a seat for a player';
  if (humans + c.bots > c.seats) return 'Not enough seats for the players already here';
  if (c.turnTimerMs !== null && (c.turnTimerMs < SETTINGS_LIMITS.turnTimerMs[0] || c.turnTimerMs > SETTINGS_LIMITS.turnTimerMs[1])) {
    return 'Turn timer out of range';
  }
  return null;
}

export interface Finish {
  seat: number;
  total: number;
  coins: number;
  /** Ranked: left the game (or was still away at the end). */
  quit?: boolean;
}

/**
 * Finishing place per seat (1 = first).
 * Ranked: equal totals share a place (an Elo draw) and everyone who quit shares last place, below all who stayed.
 * Other games: equal totals are split by coins; equal totals and coins share a place.
 */
export function placesOf(finish: Finish[], ranked: boolean): Map<number, number> {
  const out = new Map<number, number>();
  if (!ranked) {
    for (const f of finish) {
      out.set(f.seat, 1 + finish.filter((b) => b.total > f.total || (b.total === f.total && b.coins > f.coins)).length);
    }
    return out;
  }
  const stayed = finish.filter((f) => !f.quit);
  for (const f of finish) {
    out.set(f.seat, f.quit ? stayed.length + 1 : 1 + stayed.filter((b) => b.total > f.total).length);
  }
  return out;
}

export const MAX_SEATS = 7;
const TAKEOVER_LEVEL: BotLevel = 'normal';

interface Member {
  id: SeatId;
  kind: 'human' | 'bot';
  name: string;
  botLevel?: BotLevel;
  academyId: string | null;
  /** Humans only: secret used to rejoin. */
  token?: string;
  conn: Conn | null;
  graceTimer?: unknown;
  /** A human seat currently played by a bot because its player is away. */
  botControlled: boolean;
  /** Left the game on purpose (not just disconnected); a bot keeps playing the seat. */
  left?: boolean;
  engineSeat: number;
  /** Reaction rate limit: tokens left and when they were last counted. */
  reactTokens?: number;
  reactAt?: number;
  /** Humans only: the account playing this seat, if logged in. */
  accountId?: string;
  /** Its username, shown on the seat so others can befriend, block or report it. */
  username?: string;
  /** Humans only: the avatar of the account last seen on this seat. */
  avatar?: Avatar | null;
  /** After the game: this player tapped "Play again". */
  ready?: boolean;
}

/**
 * One game room: lobby, then the authoritative game.
 * Transport-agnostic: it talks to Conn objects and a Clock, so it can be tested synchronously.
 */
export class Room {
  phase: 'lobby' | 'game' = 'lobby';
  state: GameState | null = null;
  closed = false;
  lastActivity: number;

  private members: Member[] = [];
  private byConn = new Map<Conn, Member>();
  private hostId: SeatId | null = null;
  private settings: RoomSettings;
  private seatCounter = 0;
  private botCounter = 0;
  private turnSeq = 0;
  private timerSeq = -1;
  private turnTimer: unknown = null;
  private deadline: number | null = null;
  /** Made by quick match: the lobby starts itself and nobody can remove another player. */
  private quick = false;
  private startsAt: number | null = null;
  private startTimer: unknown = null;
  /** After a room game: when everyone goes back to the lobby unless all are ready before. */
  private lobbyAt: number | null = null;
  private lobbyTimer: unknown = null;
  /** The current game's results were handed to onResults. */
  private recorded = false;
  private config: RoomConfig;
  /** The current game's draw, sent with its first game message and then dropped. */
  private reveal: GameReveal | null = null;
  private side: Side = 'A';

  constructor(
    readonly code: string,
    private readonly opts: RoomOptions,
    private readonly clock: Clock,
    readonly setup: RoomSetup = { kind: 'room' },
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.defaultSettings };
    this.config = { ...DEFAULT_ROOM_CONFIG, turnTimerMs: this.settings.turnTimerMs, ...setup.config };
    this.settings.turnTimerMs = this.config.turnTimerMs;
    this.lastActivity = clock.now();
    for (let i = 0; i < this.config.bots; i++) this.pushBot(this.config.botLevel);
  }

  /** The public-list entry, or null when this room is not listed (private, queue, started, closed or full). */
  openInfo(): OpenRoom | null {
    if (this.closed || this.phase !== 'lobby' || this.setup.kind !== 'room' || !this.config.public) return null;
    if (this.humans().length >= this.humanSeats()) return null;
    const host = this.members.find((m) => m.id === this.hostId);
    if (!host) return null;
    const { sideMode, turnTimerMs, seats, bots } = this.config;
    return { code: this.code, host: host.name, sideMode, turnTimerMs, seats, taken: this.members.length, bots };
  }

  hasMember(conn: Conn): boolean {
    return this.byConn.has(conn);
  }

  // ---------- entry points ----------

  join(conn: Conn, name: string): void {
    this.touch();
    if (this.closed) return this.fail(conn, 'no_room', 'This room has closed');
    if (this.phase !== 'lobby') return this.fail(conn, 'wrong_phase', 'The game has already started');
    if (this.members.length >= MAX_SEATS || this.humans().length >= this.humanSeats()) {
      return this.fail(conn, 'room_full', 'The room is full');
    }
    const m: Member = {
      id: this.nextSeatId(),
      kind: 'human',
      name,
      academyId: null,
      token: randomBytes(16).toString('hex'),
      conn: null,
      botControlled: false,
      engineSeat: -1,
    };
    this.setAccount(m, conn);
    this.members.push(m);
    this.hostId ??= m.id;
    this.bind(m, conn);
    conn.send({ t: 'joined', code: this.code, seatId: m.id, token: m.token! });
    this.broadcast();
  }

  rejoin(conn: Conn, token: string): void {
    this.touch();
    const m = this.members.find((x) => x.kind === 'human' && x.token === token);
    if (this.closed || !m) return this.fail(conn, 'bad_token', 'That seat is not in this room');
    if (m.conn && m.conn !== conn) {
      const old = m.conn;
      this.byConn.delete(old);
      old.close('replaced');
    }
    this.clearGrace(m);
    m.botControlled = false;
    m.left = false;
    // A login that finished after the seat was taken still counts.
    if (!m.accountId) this.setAccount(m, conn);
    this.bind(m, conn);
    conn.send({ t: 'joined', code: this.code, seatId: m.id, token: m.token! });
    this.broadcast();
  }

  /** The transport lost this connection. The seat waits `graceMs` before it is freed (lobby) or bot-played (game). */
  disconnect(conn: Conn): void {
    const m = this.byConn.get(conn);
    if (!m) return;
    this.byConn.delete(conn);
    m.conn = null;
    this.clearGrace(m);
    m.graceTimer = this.clock.setTimer(this.settings.graceMs, () => this.graceExpired(m));
    // The others may all be ready to play again already.
    if (this.replayIfAllReady()) return;
    this.broadcast();
  }

  /** The account on this connection changed its avatar. */
  refreshAvatar(conn: Conn): void {
    const m = this.byConn.get(conn);
    if (!m || this.closed) return;
    m.avatar = this.opts.avatarOf?.(conn) ?? null;
    this.broadcast();
  }

  handle(conn: Conn, msg: ClientMessage): void {
    const m = this.byConn.get(conn);
    if (!m) return this.fail(conn, 'not_in_room', 'You are not in this room');
    this.touch();
    switch (msg.t) {
      case 'leave':
        return this.leave(m);
      case 'setSeat':
        return this.setSeat(m, msg);
      case 'addBot':
        return this.hostLobby(m, () => this.addBot(m, msg.level));
      case 'roomConfig':
        return this.hostLobby(m, () => this.updateConfig(m, msg.settings));
      case 'removeSeat':
        return this.hostLobby(m, () => this.removeSeat(m, msg.seatId));
      case 'setBotLevel':
        return this.hostLobby(m, () => {
          // One level for every bot.
          const target = this.members.find((x) => x.id === msg.seatId && x.kind === 'bot');
          if (!target) return this.fail(conn, 'bad_seat', 'No such bot seat');
          this.setBotLevel(msg.level);
          this.broadcast();
        });
      case 'settings':
        return this.hostLobby(m, () => this.updateSettings(m, msg.settings));
      case 'start':
        return this.hostLobby(m, () => this.start(m));
      case 'act':
        return this.act(m, msg.action);
      case 'rematch':
      case 'playAgain':
      case 'playAgainNow':
        // A queue table plays once: Play again there means queueing again.
        if (this.setup.kind !== 'room') return this.fail(m.conn!, 'wrong_phase', 'Queue games cannot be replayed');
        return msg.t === 'rematch' ? this.rematch(m) : msg.t === 'playAgain' ? this.playAgain(m, msg.ready) : this.playAgainNow(m);
      case 'react':
        return this.react(m, msg.reaction);
      default:
        return this.fail(conn, 'bad_message', `Unexpected message ${msg.t}`);
    }
  }

  /** Queue rooms: start by itself after `ms` (empty seats up to `size` get Normal bots; queues pass 0: no bots). */
  startCountdown(ms: number, size = 0): void {
    if (this.closed || this.phase !== 'lobby') return;
    this.quick = true;
    this.clearStartTimer();
    this.startsAt = this.clock.now() + ms;
    this.startTimer = this.clock.setTimer(ms, () => {
      this.startTimer = null;
      this.startsAt = null;
      if (this.closed || this.phase !== 'lobby') return;
      while (this.members.length < Math.min(size, MAX_SEATS)) this.pushBot('normal');
      // Someone left during the countdown and nobody is left to play against.
      if (this.members.length < 2) return this.close('left');
      this.begin();
    });
    this.broadcast();
  }

  close(reason: CloseReason): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTurnTimer();
    this.clearStartTimer();
    this.clearLobbyTimer();
    for (const m of this.members) {
      this.clearGrace(m);
      if (m.conn) m.conn.close(reason);
      m.conn = null;
    }
    this.byConn.clear();
    this.setup.onChange?.();
  }

  // ---------- lobby ----------

  private humans(): Member[] {
    return this.members.filter((m) => m.kind === 'human');
  }

  /** Seats humans may take: host rooms keep the bot seats apart; queue rooms take everyone matched. */
  private humanSeats(): number {
    return this.setup.kind === 'room' ? this.config.seats - this.config.bots : MAX_SEATS;
  }

  private hostLobby(m: Member, fn: () => void): void {
    if (m.id !== this.hostId) return this.fail(m.conn!, 'not_host', 'Only the host can do that');
    if (this.phase !== 'lobby') return this.fail(m.conn!, 'wrong_phase', 'Only possible in the lobby');
    // The quick-match countdown runs the lobby: players only pick their academy.
    if (this.startsAt !== null) return this.fail(m.conn!, 'wrong_phase', 'The game starts by itself');
    fn();
  }

  private setSeat(m: Member, msg: Extract<ClientMessage, { t: 'setSeat' }>): void {
    const conn = m.conn!;
    if (this.phase !== 'lobby') return this.fail(conn, 'wrong_phase', 'Only possible in the lobby');
    const target = msg.seatId ? this.members.find((x) => x.id === msg.seatId) : m;
    const allowed = target === m || (target?.kind === 'bot' && m.id === this.hostId);
    if (!target || !allowed) return this.fail(conn, 'bad_seat', 'You cannot edit that seat');
    if (msg.academyId !== undefined) {
      // Queue tables draw every academy; in rooms each player picks their own and bots get a random one.
      if (this.setup.kind !== 'room') return this.fail(conn, 'wrong_phase', 'Academies are drawn at random');
      if (target.kind === 'bot') return this.fail(conn, 'bad_seat', 'Bots get a random academy');
    }
    if (msg.academyId) {
      if (!ACADEMIES.some((a) => a.id === msg.academyId)) return this.fail(conn, 'unknown_academy', 'Unknown academy');
      if (this.members.some((x) => x !== target && x.academyId === msg.academyId)) {
        return this.fail(conn, 'academy_taken', 'Another seat already picked that academy');
      }
    }
    if (msg.name !== undefined) target.name = msg.name;
    if (msg.academyId !== undefined) target.academyId = msg.academyId;
    this.broadcast();
  }

  /** One more bot seat (the room grows when it is full); its level becomes every bot's level. */
  private addBot(host: Member, level: BotLevel): void {
    if (this.members.length >= MAX_SEATS) return this.fail(host.conn!, 'room_full', 'The room is full');
    const seats = Math.max(this.config.seats, this.members.length + 1);
    this.applyConfig({ ...this.config, seats, bots: this.config.bots + 1, botLevel: level });
  }

  private setBotLevel(level: BotLevel): void {
    this.config.botLevel = level;
    for (const x of this.members) if (x.kind === 'bot') x.botLevel = level;
  }

  /** Host: change the room's setup; bot seats follow `bots` and `botLevel`. */
  private updateConfig(host: Member, patch: Partial<RoomConfig>): void {
    if (this.setup.kind !== 'room') return this.fail(host.conn!, 'wrong_phase', 'Queue tables cannot be changed');
    const next = { ...this.config, ...patch };
    const why = checkConfig(next, this.humans().length);
    if (why) return this.fail(host.conn!, 'bad_settings', why);
    this.applyConfig(next);
  }

  private applyConfig(next: RoomConfig): void {
    this.config = { ...next };
    this.settings.turnTimerMs = next.turnTimerMs;
    let bots = this.members.filter((x) => x.kind === 'bot');
    while (bots.length > next.bots) {
      const last = bots[bots.length - 1];
      this.members = this.members.filter((x) => x !== last);
      bots = bots.slice(0, -1);
    }
    for (let i = bots.length; i < next.bots; i++) this.pushBot(next.botLevel);
    this.setBotLevel(next.botLevel);
    this.broadcast();
  }

  private pushBot(level: BotLevel): void {
    this.members.push({
      id: this.nextSeatId(),
      kind: 'bot',
      name: `Bot ${++this.botCounter}`,
      botLevel: level,
      academyId: null,
      conn: null,
      botControlled: false,
      engineSeat: -1,
    });
  }

  private removeSeat(host: Member, seatId: SeatId): void {
    const target = this.members.find((x) => x.id === seatId);
    if (!target || target === host || (this.quick && target.kind === 'human')) {
      return this.fail(host.conn!, 'bad_seat', 'You cannot remove that seat');
    }
    if (target.kind === 'bot') {
      this.members = this.members.filter((x) => x !== target);
      return this.applyConfig({ ...this.config, bots: this.config.bots - 1 });
    }
    this.removeMember(target, 'removed');
  }

  private updateSettings(host: Member, patch: Partial<RoomSettings>): void {
    const inRange = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
    if (patch.graceMs !== undefined && !inRange(patch.graceMs, SETTINGS_LIMITS.graceMs)) {
      return this.fail(host.conn!, 'bad_settings', 'Grace period out of range');
    }
    if (patch.turnTimerMs != null && !inRange(patch.turnTimerMs, SETTINGS_LIMITS.turnTimerMs)) {
      return this.fail(host.conn!, 'bad_settings', 'Turn timer out of range');
    }
    this.settings = { ...this.settings, ...patch };
    this.config.turnTimerMs = this.settings.turnTimerMs;
    this.broadcast();
  }

  /** The conn moves on to another room: leave this one without telling it. */
  detach(conn: Conn): void {
    const m = this.byConn.get(conn);
    if (m) this.leave(m, false);
  }

  private leave(m: Member, notify = true): void {
    const conn = m.conn!;
    if (this.phase === 'lobby') return this.removeMember(m, notify ? 'left' : null);
    // After a room game, Main menu: that player goes, everyone else goes back to the room's lobby.
    if (this.gameOver() && this.setup.kind === 'room') {
      this.passHost(m);
      this.members = this.members.filter((x) => x !== m);
      this.clearGrace(m);
      this.byConn.delete(conn);
      m.conn = null;
      if (notify) conn.close('left');
      return this.toLobby();
    }
    // In a game the seat stays (the token still works); a bot plays it from now on.
    this.byConn.delete(conn);
    m.conn = null;
    if (notify) conn.close('left');
    m.botControlled = true;
    m.left = true;
    // With no real player left, nobody is watching: end the room instead of letting bots play on.
    const stay = this.members.filter((x) => x.kind === 'human' && !x.left);
    if (stay.length === 0) return this.close('left');
    if (this.hostId === m.id) this.hostId = (stay.find((x) => x.conn) ?? stay[0]).id;
    if (this.replayIfAllReady()) return;
    this.advance();
  }

  private removeMember(m: Member, reason: CloseReason | null): void {
    this.clearGrace(m);
    this.passHost(m);
    this.members = this.members.filter((x) => x !== m);
    if (m.conn) {
      this.byConn.delete(m.conn);
      if (reason) m.conn.close(reason);
      m.conn = null;
    }
    if (!this.members.some((x) => x.kind === 'human')) return this.close('left');
    this.broadcast();
  }

  private graceExpired(m: Member): void {
    m.graceTimer = undefined;
    if (m.conn || this.closed || !this.members.includes(m)) return;
    if (this.phase === 'lobby') return this.removeMember(m, 'removed');
    m.botControlled = true;
    this.advance();
  }

  private start(host: Member): void {
    const n = this.members.length;
    if (n < 2 || n > MAX_SEATS) return this.fail(host.conn!, 'seat_count', 'A game needs 2 to 7 seats');
    this.begin();
  }

  private begin(): void {
    const n = this.members.length;
    const seed = this.opts.seed?.() ?? randomInt(2 ** 31 - 1);
    // One side for the whole table; a random side comes from the game's seed.
    const mode = this.setup.kind === 'room' ? this.config.sideMode : 'random';
    this.side = mode === 'random' ? (seed % 2 === 0 ? 'A' : 'B') : mode;
    const seats: SeatConfig[] = this.members.map((m) => ({
      kind: m.kind,
      name: m.name,
      side: this.side,
      ...(m.academyId ? { academyId: m.academyId } : {}),
      ...(m.kind === 'bot' ? { botLevel: m.botLevel ?? 'normal' } : {}),
    }));
    const game = createGame({ seed, seats });
    // The engine adds the Rival Archmage (2 seats) on side A; it plays the table's side too.
    this.state = { ...game, players: game.players.map((p) => (p.side === this.side ? p : { ...p, side: this.side })) };
    this.reveal = {
      side: this.side,
      academies: this.state.players.map((p) => ({ seat: p.seat, academyId: p.academyId })),
    };
    // With 2 seats the engine inserts the Rival Archmage at engine seat 1.
    this.members.forEach((m, i) => (m.engineSeat = n === 2 ? [0, 2][i] : i));
    this.phase = 'game';
    this.recorded = false;
    this.turnSeq = 0;
    this.timerSeq = -1;
    this.advance();
  }

  /** After the game, anyone: the whole table goes back to the room's lobby (the host can change settings there). */
  private rematch(m: Member): void {
    if (!this.gameOver()) return this.fail(m.conn!, 'wrong_phase', 'The game has not ended');
    this.toLobby();
  }

  /** Everyone back to the room's lobby; players who are gone are dropped. */
  private toLobby(): void {
    this.clearTurnTimer();
    this.clearLobbyTimer();
    this.phase = 'lobby';
    this.state = null;
    for (const x of [...this.members]) {
      x.botControlled = false;
      x.left = false;
      x.engineSeat = -1;
      x.ready = false;
      if (x.kind === 'human' && !x.conn) {
        this.clearGrace(x);
        this.passHost(x);
        this.members = this.members.filter((y) => y !== x);
      }
    }
    if (!this.members.some((x) => x.kind === 'human' && x.conn)) return this.close('left');
    if (!this.members.some((x) => x.id === this.hostId)) this.hostId = this.members.find((x) => x.kind === 'human')!.id;
    this.broadcast();
  }

  /** `m` is going: if it hosts, the next player round the table (connected first) becomes host. */
  private passHost(m: Member): void {
    if (this.hostId !== m.id) return;
    const i = this.members.indexOf(m);
    const order = [...this.members.slice(i + 1), ...this.members.slice(0, Math.max(i, 0))].filter((x) => x !== m && x.kind === 'human');
    this.hostId = (order.find((x) => x.conn) ?? order[0])?.id ?? null;
  }

  private gameOver(): boolean {
    return this.phase === 'game' && this.state?.phase === 'ended';
  }

  /** After the game: mark me (not) ready; once every connected player is ready, the next game starts. */
  private playAgain(m: Member, ready: boolean): void {
    if (!this.gameOver()) return this.fail(m.conn!, 'wrong_phase', 'The game has not ended');
    m.ready = ready;
    if (!this.replayIfAllReady()) this.broadcast();
  }

  /** The host starts the next game without waiting; a host who is gone cannot block it. */
  private playAgainNow(m: Member): void {
    const host = this.members.find((x) => x.id === this.hostId);
    if (m.id !== this.hostId && host?.conn) return this.fail(m.conn!, 'not_host', 'Only the host can do that');
    if (!this.gameOver()) return this.fail(m.conn!, 'wrong_phase', 'The game has not ended');
    this.hostId = m.id;
    this.replay();
  }

  private replayIfAllReady(): boolean {
    if (!this.gameOver()) return false;
    const here = this.members.filter((x) => x.kind === 'human' && x.conn);
    if (here.length === 0 || !here.every((x) => x.ready)) return false;
    this.replay();
    return true;
  }

  /**
   * Next game at the same table: same seats, bots and settings; players who are gone are dropped.
   * Academies nobody chose are drawn again. Too few seats left: back to the lobby instead.
   */
  private replay(): void {
    this.clearTurnTimer();
    this.clearLobbyTimer();
    for (const x of [...this.members]) {
      if (x.kind !== 'human' || x.conn) continue;
      this.clearGrace(x);
      this.passHost(x);
      this.members = this.members.filter((y) => y !== x);
    }
    const humans = this.members.filter((x) => x.kind === 'human');
    if (humans.length === 0) return this.close('left');
    if (!humans.some((x) => x.id === this.hostId)) this.hostId = humans[0].id;
    for (const x of this.members) {
      x.ready = false;
      x.botControlled = false;
      x.left = false;
      x.engineSeat = -1;
    }
    if (this.members.length < 2) {
      this.phase = 'lobby';
      this.state = null;
      return this.broadcast();
    }
    this.begin();
  }

  // ---------- reactions ----------

  /** Broadcast a quick reaction; over the per-seat limit it is dropped silently. Only connected players reach here, never bots. */
  private react(m: Member, reaction: ReactionId): void {
    const now = this.clock.now();
    const tokens = Math.min(REACTION_BURST, (m.reactTokens ?? REACTION_BURST) + (now - (m.reactAt ?? now)) / REACTION_REFILL_MS);
    m.reactAt = now;
    if (tokens < 1) {
      m.reactTokens = tokens;
      return;
    }
    m.reactTokens = tokens - 1;
    const seat = this.phase === 'game' ? m.engineSeat : null;
    for (const x of this.members) {
      if (!x.conn || (m.accountId && this.opts.hidesFrom?.(x.conn, m.accountId))) continue;
      x.conn.send({ t: 'reaction', seatId: m.id, seat, reaction });
    }
  }

  // ---------- game ----------

  private act(m: Member, action: Action): void {
    const conn = m.conn!;
    if (this.phase !== 'game' || !this.state) return this.fail(conn, 'wrong_phase', 'No game in progress');
    try {
      this.state = submitAction(this.state, m.engineSeat, action);
    } catch (e) {
      return this.fail(conn, 'illegal_action', e instanceof Error ? e.message : 'Illegal action');
    }
    this.advance();
  }

  private memberAt(seat: number): Member | undefined {
    return this.members.find((m) => m.engineSeat === seat);
  }

  /** Submit for every seat a bot plays this turn (bots, the Archmage, taken-over humans; all humans when `everyone`). */
  private autoPick(s: GameState, everyone: boolean): GameState {
    let next = s;
    for (const seat of actingSeats(next)) {
      const p = next.players[seat];
      if (p.pending) continue;
      if (p.config.kind === 'archmage') next = submitAction(next, seat, archmagePick(next, seat));
      else if (p.config.kind === 'bot') next = submitAction(next, seat, botPick(next, seat, p.config.botLevel ?? 'normal'));
      else if (everyone || this.memberAt(seat)?.botControlled) next = submitAction(next, seat, botPick(next, seat, TAKEOVER_LEVEL));
    }
    return next;
  }

  /** Let bots act and resolve every turn that is complete, then tell everyone. */
  private advance(): void {
    let s = this.state!;
    while (s.phase !== 'ended') {
      s = this.autoPick(s, false);
      if (!allSubmitted(s)) break;
      s = resolveTurn(s);
      this.turnSeq++;
    }
    this.state = s;
    if (s.phase === 'ended' && !this.recorded) {
      this.record(s);
      this.armLobbyTimer();
    }
    this.armTurnTimer();
    this.broadcast();
  }

  /** One result per account in the game (an account in two seats counts once). */
  private record(s: GameState): void {
    this.recorded = true;
    if (!this.opts.onResults) return;
    const scores = finalScores(s);
    const rivals = scores.filter((b) => s.players[b.seat].config.kind !== 'archmage');
    const won = new Set(winners(s));
    const coins = (seat: number) => s.players[seat].coins;
    const ranked = this.setup.kind === 'ranked';
    // Ranked: a player who left (or was still away at the end) is last, whatever the bot made of the seat.
    const quit = (seat: number) => {
      const x = this.memberAt(seat);
      return ranked && x?.kind === 'human' && (!!x.left || x.botControlled);
    };
    const places = placesOf(
      rivals.map((b) => ({ seat: b.seat, total: b.total, coins: coins(b.seat), quit: quit(b.seat) })),
      ranked,
    );
    const seen = new Set<string>();
    const records: GameRecord[] = [];
    for (const m of this.members) {
      if (m.kind !== 'human' || !m.accountId || seen.has(m.accountId)) continue;
      seen.add(m.accountId);
      const mine = scores.find((b) => b.seat === m.engineSeat);
      if (!mine) continue;
      records.push({
        userId: m.accountId,
        academyId: s.players[m.engineSeat].academyId,
        score: mine.total,
        place: places.get(m.engineSeat)!,
        won: won.has(m.engineSeat) && !quit(m.engineSeat),
        players: this.members.length,
        playedAt: this.clock.now(),
        kind: this.setup.kind,
        ...(this.setup.queue ? { queue: this.setup.queue } : {}),
        side: this.side,
      });
    }
    if (records.length) this.opts.onResults(records);
  }

  private armTurnTimer(): void {
    const ms = this.settings.turnTimerMs;
    if (this.state?.phase === 'ended' || ms == null) return this.clearTurnTimer();
    if (this.timerSeq === this.turnSeq) return; // same turn: keep the running clock
    this.clearTurnTimer();
    this.timerSeq = this.turnSeq;
    this.deadline = this.clock.now() + ms;
    this.turnTimer = this.clock.setTimer(ms, () => {
      this.turnTimer = null;
      if (this.closed || !this.state || this.state.phase === 'ended') return;
      this.state = this.autoPick(this.state, true);
      this.advance();
    });
  }

  /** Room games: not everyone tapped Play again in time, so the table goes back to the lobby. */
  private armLobbyTimer(): void {
    if (this.setup.kind !== 'room') return;
    this.clearLobbyTimer();
    this.lobbyAt = this.clock.now() + PLAY_AGAIN_MS;
    this.lobbyTimer = this.clock.setTimer(PLAY_AGAIN_MS, () => {
      this.lobbyTimer = null;
      this.lobbyAt = null;
      if (!this.closed && this.gameOver()) this.toLobby();
    });
  }

  private clearLobbyTimer(): void {
    if (this.lobbyTimer !== null) this.clock.clearTimer(this.lobbyTimer);
    this.lobbyTimer = null;
    this.lobbyAt = null;
  }

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) this.clock.clearTimer(this.turnTimer);
    this.turnTimer = null;
    this.deadline = null;
    this.timerSeq = -1;
  }

  // ---------- output ----------

  private broadcast(): void {
    if (this.closed) return;
    this.setup.onChange?.();
    if (this.phase === 'lobby') {
      const lobby = this.lobbyState();
      for (const m of this.members) m.conn?.send({ t: 'lobby', lobby });
      return;
    }
    const s = this.state!;
    const seats = this.seatStatus();
    const result = s.phase === 'ended' ? { scores: finalScores(s), winners: winners(s) } : undefined;
    // The draw goes out once, with the game's first message.
    const reveal = this.reveal;
    this.reveal = null;
    for (const m of this.members) {
      if (!m.conn) continue;
      const seat = m.engineSeat;
      const legal = s.players[seat].pending ? [] : legalActions(s, seat);
      m.conn.send({ t: 'game', view: viewFor(s, seat), legal, seats, deadline: this.deadline, kind: this.setup.kind, ...(this.setup.queue ? { queue: this.setup.queue } : {}), ...(result && this.lobbyAt !== null ? { lobbyAt: this.lobbyAt } : {}), ...(result ? { result } : {}), ...(reveal ? { reveal } : {}) });
    }
  }

  private lobbyState(): LobbyState {
    return {
      code: this.code,
      inviteUrl: `${this.opts.clientUrl}/?room=${this.code}`,
      hostId: this.hostId ?? '',
      settings: { ...this.settings },
      config: { ...this.config },
      kind: this.setup.kind,
      ...(this.setup.queue ? { queue: this.setup.queue } : {}),
      ...(this.quick ? { quick: true, startsAt: this.startsAt } : {}),
      seats: this.members.map((m) => ({
        id: m.id,
        kind: m.kind,
        name: m.name,
        ...(m.kind === 'bot' ? { botLevel: m.botLevel } : {}),
        academyId: m.academyId,
        connected: m.kind === 'bot' || !!m.conn,
        ...(m.username ? { username: m.username } : {}),
        ...(m.avatar ? { avatar: m.avatar } : {}),
      })),
    };
  }

  private seatStatus(): SeatStatus[] {
    const over = this.state!.phase === 'ended';
    return this.state!.players.map((p) => {
      const m = this.memberAt(p.seat);
      return {
        seat: p.seat,
        name: p.config.name,
        kind: p.config.kind,
        connected: p.config.kind !== 'human' || !!m?.conn,
        botControlled: !!m?.botControlled,
        ...(m?.username ? { username: m.username } : {}),
        ...(m?.avatar ? { avatar: m.avatar } : {}),
        ...(m && m.id === this.hostId ? { host: true } : {}),
        ...(over && m?.kind === 'human' ? { ready: !!m.ready } : {}),
      };
    });
  }

  // ---------- helpers ----------

  /** Remember the account logged in on this connection (if any) for stats and the seat's username. */
  private setAccount(m: Member, conn: Conn): void {
    const account = this.opts.accountOf?.(conn);
    if (!account) return;
    m.accountId = account;
    const username = this.opts.usernameOf?.(conn);
    if (username) m.username = username;
  }

  private bind(m: Member, conn: Conn): void {
    m.conn = conn;
    if (this.opts.avatarOf) m.avatar = this.opts.avatarOf(conn);
    this.byConn.set(conn, m);
  }

  private clearStartTimer(): void {
    if (this.startTimer !== null) this.clock.clearTimer(this.startTimer);
    this.startTimer = null;
    this.startsAt = null;
  }

  private clearGrace(m: Member): void {
    if (m.graceTimer !== undefined) this.clock.clearTimer(m.graceTimer);
    m.graceTimer = undefined;
  }

  private nextSeatId(): SeatId {
    return `s${++this.seatCounter}`;
  }

  private touch(): void {
    this.lastActivity = this.clock.now();
  }

  private fail(conn: Conn, code: ErrorCode, message: string): void {
    conn.send({ t: 'error', code, message });
  }
}
