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
  DEFAULT_SETTINGS,
  REACTION_BURST,
  REACTION_REFILL_MS,
  SETTINGS_LIMITS,
  type ClientMessage,
  type CloseReason,
  type ErrorCode,
  type LobbyState,
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
  /** Called once per finished game with one record per account seated in it. */
  onResults?(records: GameRecord[]): void;
}

export const MAX_SEATS = 7;
const TAKEOVER_LEVEL: BotLevel = 'normal';

interface Member {
  id: SeatId;
  kind: 'human' | 'bot';
  name: string;
  botLevel?: BotLevel;
  academyId: string | null;
  side: 'A' | 'B';
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
  /** The current game's results were handed to onResults. */
  private recorded = false;

  constructor(
    readonly code: string,
    private readonly opts: RoomOptions,
    private readonly clock: Clock,
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.defaultSettings };
    this.lastActivity = clock.now();
  }

  hasMember(conn: Conn): boolean {
    return this.byConn.has(conn);
  }

  // ---------- entry points ----------

  join(conn: Conn, name: string): void {
    this.touch();
    if (this.closed) return this.fail(conn, 'no_room', 'This room has closed');
    if (this.phase !== 'lobby') return this.fail(conn, 'wrong_phase', 'The game has already started');
    if (this.members.length >= MAX_SEATS) return this.fail(conn, 'room_full', 'The room is full');
    const m: Member = {
      id: this.nextSeatId(),
      kind: 'human',
      name,
      academyId: null,
      side: 'A',
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
      case 'removeSeat':
        return this.hostLobby(m, () => this.removeSeat(m, msg.seatId));
      case 'setBotLevel':
        return this.hostLobby(m, () => {
          const target = this.members.find((x) => x.id === msg.seatId && x.kind === 'bot');
          if (!target) return this.fail(conn, 'bad_seat', 'No such bot seat');
          target.botLevel = msg.level;
          this.broadcast();
        });
      case 'settings':
        return this.hostLobby(m, () => this.updateSettings(m, msg.settings));
      case 'start':
        return this.hostLobby(m, () => this.start(m));
      case 'act':
        return this.act(m, msg.action);
      case 'rematch':
        return this.rematch(m);
      case 'react':
        return this.react(m, msg.reaction);
      default:
        return this.fail(conn, 'bad_message', `Unexpected message ${msg.t}`);
    }
  }

  /** Quick match: start by itself after `ms`, filling empty seats up to `size` with Normal bots. */
  startCountdown(ms: number, size: number): void {
    if (this.closed || this.phase !== 'lobby') return;
    this.quick = true;
    this.clearStartTimer();
    this.startsAt = this.clock.now() + ms;
    this.startTimer = this.clock.setTimer(ms, () => {
      this.startTimer = null;
      this.startsAt = null;
      if (this.closed || this.phase !== 'lobby') return;
      while (this.members.length < Math.min(size, MAX_SEATS)) this.pushBot('normal');
      this.begin();
    });
    this.broadcast();
  }

  close(reason: CloseReason): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTurnTimer();
    this.clearStartTimer();
    for (const m of this.members) {
      this.clearGrace(m);
      if (m.conn) m.conn.close(reason);
      m.conn = null;
    }
    this.byConn.clear();
  }

  // ---------- lobby ----------

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
    if (msg.academyId) {
      if (!ACADEMIES.some((a) => a.id === msg.academyId)) return this.fail(conn, 'unknown_academy', 'Unknown academy');
      if (this.members.some((x) => x !== target && x.academyId === msg.academyId)) {
        return this.fail(conn, 'academy_taken', 'Another seat already picked that academy');
      }
    }
    if (msg.name !== undefined) target.name = msg.name;
    if (msg.academyId !== undefined) target.academyId = msg.academyId;
    if (msg.side !== undefined) target.side = msg.side;
    this.broadcast();
  }

  private addBot(host: Member, level: BotLevel): void {
    if (this.members.length >= MAX_SEATS) return this.fail(host.conn!, 'room_full', 'The room is full');
    this.pushBot(level);
    this.broadcast();
  }

  private pushBot(level: BotLevel): void {
    this.members.push({
      id: this.nextSeatId(),
      kind: 'bot',
      name: `Bot ${++this.botCounter}`,
      botLevel: level,
      academyId: null,
      side: 'A',
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
    this.advance();
  }

  private removeMember(m: Member, reason: CloseReason | null): void {
    this.clearGrace(m);
    this.members = this.members.filter((x) => x !== m);
    if (m.conn) {
      this.byConn.delete(m.conn);
      if (reason) m.conn.close(reason);
      m.conn = null;
    }
    if (this.hostId === m.id) {
      const humans = this.members.filter((x) => x.kind === 'human');
      this.hostId = (humans.find((x) => x.conn) ?? humans[0])?.id ?? null;
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
    const seats: SeatConfig[] = this.members.map((m) => ({
      kind: m.kind,
      name: m.name,
      side: m.side,
      ...(m.academyId ? { academyId: m.academyId } : {}),
      ...(m.kind === 'bot' ? { botLevel: m.botLevel ?? 'normal' } : {}),
    }));
    const seed = this.opts.seed?.() ?? randomInt(2 ** 31 - 1);
    this.state = createGame({ seed, seats });
    // With 2 seats the engine inserts the Rival Archmage at engine seat 1.
    this.members.forEach((m, i) => (m.engineSeat = n === 2 ? [0, 2][i] : i));
    this.phase = 'game';
    this.recorded = false;
    this.turnSeq = 0;
    this.timerSeq = -1;
    this.advance();
  }

  private rematch(m: Member): void {
    const host = this.members.find((x) => x.id === this.hostId);
    // A host who is gone cannot block the rematch: any connected player may call it and becomes host.
    if (m.id !== this.hostId && host?.conn) return this.fail(m.conn!, 'not_host', 'Only the host can do that');
    if (this.phase !== 'game' || this.state?.phase !== 'ended') {
      return this.fail(m.conn!, 'wrong_phase', 'The game has not ended');
    }
    this.clearTurnTimer();
    this.phase = 'lobby';
    this.state = null;
    this.hostId = m.id === this.hostId || !host?.conn ? m.id : this.hostId;
    for (const x of [...this.members]) {
      x.botControlled = false;
      x.engineSeat = -1;
      if (x.kind === 'human' && !x.conn) this.removeMember(x, 'removed');
    }
    if (!this.closed) this.broadcast();
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
    if (s.phase === 'ended' && !this.recorded) this.record(s);
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
    const seen = new Set<string>();
    const records: GameRecord[] = [];
    for (const m of this.members) {
      if (m.kind !== 'human' || !m.accountId || seen.has(m.accountId)) continue;
      seen.add(m.accountId);
      const mine = scores.find((b) => b.seat === m.engineSeat);
      if (!mine) continue;
      const ahead = rivals.filter((b) => b.total > mine.total || (b.total === mine.total && coins(b.seat) > coins(mine.seat)));
      records.push({
        userId: m.accountId,
        academyId: s.players[m.engineSeat].academyId,
        score: mine.total,
        place: 1 + ahead.length,
        won: won.has(m.engineSeat),
        players: this.members.length,
        playedAt: this.clock.now(),
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

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) this.clock.clearTimer(this.turnTimer);
    this.turnTimer = null;
    this.deadline = null;
    this.timerSeq = -1;
  }

  // ---------- output ----------

  private broadcast(): void {
    if (this.closed) return;
    if (this.phase === 'lobby') {
      const lobby = this.lobbyState();
      for (const m of this.members) m.conn?.send({ t: 'lobby', lobby });
      return;
    }
    const s = this.state!;
    const seats = this.seatStatus();
    const result = s.phase === 'ended' ? { scores: finalScores(s), winners: winners(s) } : undefined;
    for (const m of this.members) {
      if (!m.conn) continue;
      const seat = m.engineSeat;
      const legal = s.players[seat].pending ? [] : legalActions(s, seat);
      m.conn.send({ t: 'game', view: viewFor(s, seat), legal, seats, deadline: this.deadline, ...(result ? { result } : {}) });
    }
  }

  private lobbyState(): LobbyState {
    return {
      code: this.code,
      inviteUrl: `${this.opts.clientUrl}/?room=${this.code}`,
      hostId: this.hostId ?? '',
      settings: { ...this.settings },
      ...(this.quick ? { quick: true, startsAt: this.startsAt } : {}),
      seats: this.members.map((m) => ({
        id: m.id,
        kind: m.kind,
        name: m.name,
        ...(m.kind === 'bot' ? { botLevel: m.botLevel } : {}),
        academyId: m.academyId,
        side: m.side,
        connected: m.kind === 'bot' || !!m.conn,
        ...(m.username ? { username: m.username } : {}),
      })),
    };
  }

  private seatStatus(): SeatStatus[] {
    return this.state!.players.map((p) => {
      const m = this.memberAt(p.seat);
      return {
        seat: p.seat,
        name: p.config.name,
        kind: p.config.kind,
        connected: p.config.kind !== 'human' || !!m?.conn,
        botControlled: !!m?.botControlled,
        ...(m?.username ? { username: m.username } : {}),
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
