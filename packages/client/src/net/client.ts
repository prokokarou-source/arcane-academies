/**
 * The connection to the game server and everything the screens need to know about it.
 * Framework-free: sockets, storage and timers are injected so tests can drive it.
 */
import type { Action, BotLevel, PlayerView } from '@arcane/engine';
import { SOCIAL_ERRORS, isSocialMessage } from '@arcane/protocol';
import type { Avatar, ClientMessage, ErrorCode, FriendList, LeaderRow, LobbyState, Profile, PushSub, QuickSize, ReactionId, RoomSettings, SeatId, ServerMessage } from '@arcane/protocol';
import { termDuels } from '../game/derive';
import { clearAccountToken, clearSession, loadAccountToken, loadSession, saveAccountToken, saveSession, type Session } from './session';

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror?: ((ev: unknown) => void) | null;
}

export interface ClientDeps {
  url: string;
  createSocket(url: string): SocketLike;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** Wall clock (ms); Date.now when not given. */
  now?(): number;
}

/** A quick-match search in progress. */
export interface QuickSearch {
  size: QuickSize;
  /** Players searching right now, me included (0 until the server answers). */
  searching: number;
  /** Local time (ms) the search began. */
  since: number;
}

export type Notice = 'replaced' | 'expired' | 'left' | 'removed' | 'rejoinFailed';
export type GameMsg = Extract<ServerMessage, { t: 'game' }>;
export type SeatPatch = Omit<Extract<ClientMessage, { t: 'setSeat' }>, 't'>;

/** My duels of the Term that just ended, kept until the player dismisses them. */
export interface TermDuels {
  term: number;
  /** The view right after the duels (duel power at the time). */
  view: PlayerView;
  /** The tokens I gained: +n per win, -1 per loss; ties add none. */
  deltas: number[];
}

export type Reaction = Omit<Extract<ServerMessage, { t: 'reaction' }>, 't'>;

export interface Invite {
  from: string;
  code: string;
}

export interface ClientState {
  conn: 'connecting' | 'open' | 'reconnecting' | 'stopped';
  seatId: SeatId | null;
  code: string | null;
  hostId: SeatId | null;
  lobby: LobbyState | null;
  game: GameMsg | null;
  /** The view before the latest game message, used to show what changed (Term duels). */
  prevView: PlayerView | null;
  duels: TermDuels | null;
  error: { code: ErrorCode; message: string } | null;
  notice: Notice | null;
  /** True after an act was sent until the server answers: blocks double taps. */
  acting: boolean;
  /** True while a game stored on this phone is being rejoined at startup. */
  restoring: boolean;
  /** Logged-in username, or null for a guest. */
  account: string | null;
  /** My account's avatar (null: guest or the default). */
  avatar: Avatar | null;
  /** A signup, login or saved-login check is waiting for the server. */
  accountPending: boolean;
  friends: FriendList | null;
  /** Room invites from friends, newest last. */
  invites: Invite[];
  /** The last account or friend error, shown on those screens instead of the room banner. */
  socialError: { code: ErrorCode; message: string } | null;
  /** Searching for a quick match. */
  quick: QuickSearch | null;
  /** My stats and last games, as last fetched. */
  profile: Profile | null;
  /** Me and my friends ranked, as last fetched. */
  leaderboard: LeaderRow[] | null;
  /** Set when the server confirmed a password change. */
  passwordChanged: boolean;
  /** The server's push (VAPID) public key once logged in; null when the server has push off. */
  pushKey: string | null;
}

const OPEN = 1;
const MIN_BACKOFF = 500;
const MAX_BACKOFF = 8000;
const CLOSE_NOTICE: Record<number, Notice> = { 4001: 'replaced', 4002: 'expired' };
const DEAD_SESSION: ErrorCode[] = ['no_room', 'bad_token', 'not_in_room'];
const NO_STATS = { profile: null, leaderboard: null, passwordChanged: false } as const;

const INITIAL: ClientState = {
  conn: 'connecting',
  seatId: null,
  code: null,
  hostId: null,
  lobby: null,
  game: null,
  prevView: null,
  duels: null,
  error: null,
  notice: null,
  acting: false,
  restoring: false,
  account: null,
  avatar: null,
  accountPending: false,
  friends: null,
  invites: [],
  socialError: null,
  quick: null,
  profile: null,
  leaderboard: null,
  passwordChanged: false,
  pushKey: null,
};

export class GameClient {
  private state: ClientState = INITIAL;
  private listeners = new Set<() => void>();
  private reactionListeners = new Set<(r: Reaction) => void>();
  private ws: SocketLike | null = null;
  private queue: ClientMessage[] = [];
  private backoff = MIN_BACKOFF;
  private timer: unknown = null;
  private stopped = false;
  private rejoinPending = false;
  /** The seat this client holds. Storage is read once at start (reload) and only written afterwards, so tabs never steal from each other. */
  private session: Session | null = null;
  private soloPlan: { bots: number; level: BotLevel } | null = null;
  /** Saved login, resent on every (re)connect so presence follows the socket. */
  private accountToken: string | null = null;
  /** The quick-match request, resent after a reconnect (the server drops the queue entry with the socket). */
  private quickReq: Extract<ClientMessage, { t: 'quickMatch' }> | null = null;

  constructor(private readonly deps: ClientDeps) {}

  // ---------- store ----------

  getState = (): ClientState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Reactions are events, not state: a late screen should not replay old ones. */
  onReaction = (fn: (r: Reaction) => void): (() => void) => {
    this.reactionListeners.add(fn);
    return () => this.reactionListeners.delete(fn);
  };

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  // ---------- lifecycle ----------

  start(): void {
    this.stopped = false;
    this.session = loadSession(this.deps.storage);
    this.accountToken = loadAccountToken(this.deps.storage);
    this.set({
      restoring: !!this.session,
      accountPending: !!this.accountToken,
      ...(this.session?.hostId ? { hostId: this.session.hostId } : {}),
    });
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.set({ conn: 'stopped' });
  }

  /** The server answered over HTTP (e.g. it just woke up): if a reconnect is waiting on backoff, try now. */
  wakeUp(): void {
    if (this.stopped || this.ws || this.timer === null) return;
    this.deps.clearTimeout(this.timer);
    this.backoff = MIN_BACKOFF;
    this.connect();
  }

  private connect(): void {
    this.timer = null;
    const ws = this.deps.createSocket(this.deps.url);
    this.ws = ws;
    ws.onopen = () => {
      if (ws === this.ws) this.onOpen();
    };
    ws.onmessage = (ev) => {
      if (ws === this.ws) this.onMessage(ev.data);
    };
    // Errors are always followed by a close event, which does the work.
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (ws === this.ws) this.onClose(ev.code);
    };
  }

  private onOpen(): void {
    this.backoff = MIN_BACKOFF;
    this.set({ conn: 'open' });
    if (this.accountToken) this.raw({ t: 'auth', token: this.accountToken });
    const session = this.session;
    if (session) {
      // Moves made while offline wait until the seat is back (or dropped, see dropSession).
      this.rejoinPending = true;
      this.raw({ t: 'rejoin', code: session.code, token: session.token });
    } else {
      this.flushQueue();
      if (this.quickReq) this.raw(this.quickReq);
    }
  }

  private onClose(code: number): void {
    this.ws = null;
    this.rejoinPending = false;
    if (this.stopped) return;
    const notice = CLOSE_NOTICE[code];
    if (notice) {
      // The seat is gone for good: forget it, but stay connected so Home can create or join again.
      this.dropSession(notice);
      this.set({ conn: 'connecting' });
      this.connect();
      return;
    }
    this.set({ conn: 'reconnecting', acting: false });
    this.timer = this.deps.setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  private onMessage(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(data)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'joined':
        this.rejoined();
        {
          const hostId = this.session?.code === msg.code ? this.session.hostId : undefined;
          this.session = { code: msg.code, token: msg.token, ...(hostId ? { hostId } : {}) };
          saveSession(this.deps.storage, this.session);
          this.quickReq = null;
          this.set({ seatId: msg.seatId, code: msg.code, hostId: hostId ?? null, notice: null, error: null, quick: null });
        }
        return;
      case 'lobby':
        this.rejoined();
        this.set({ lobby: msg.lobby, hostId: msg.lobby.hostId, game: null, prevView: null, duels: null, acting: false });
        if (this.session && this.session.hostId !== msg.lobby.hostId) {
          this.session = { ...this.session, hostId: msg.lobby.hostId };
          saveSession(this.deps.storage, this.session);
        }
        this.runSoloPlan(msg.lobby);
        return;
      case 'game':
        this.rejoined();
        this.onGame(msg);
        return;
      case 'account':
        if (msg.username === null) {
          this.accountToken = null;
          clearAccountToken(this.deps.storage);
          this.set({ account: null, avatar: null, accountPending: false, friends: null, invites: [], socialError: null, pushKey: null, ...NO_STATS });
        } else {
          if (msg.token) {
            this.accountToken = msg.token;
            saveAccountToken(this.deps.storage, msg.token);
          }
          this.set({ account: msg.username, avatar: msg.avatar ?? null, accountPending: false, socialError: null });
        }
        return;
      case 'friends':
        this.set({ friends: msg.list });
        return;
      case 'quickQueue': {
        if (!this.quickReq) return;
        const since = this.state.quick?.since ?? this.now() - msg.waitedMs;
        this.set({ quick: { size: msg.size, searching: msg.searching, since } });
        return;
      }
      case 'quickCancelled':
        this.quickReq = null;
        this.set({ quick: null });
        return;
      case 'pushKey':
        this.set({ pushKey: msg.key });
        return;
      case 'presence': {
        const list = this.state.friends;
        if (!list) return;
        const friends = list.friends
          .map((f) => (f.username === msg.username ? { ...f, online: msg.online } : f))
          .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username, 'en', { sensitivity: 'base' }));
        this.set({ friends: { ...list, friends } });
        return;
      }
      case 'profile':
        this.set({ profile: msg.profile });
        return;
      case 'leaderboard':
        this.set({ leaderboard: msg.rows });
        return;
      case 'passwordChanged':
        this.set({ passwordChanged: true, accountPending: false, socialError: null });
        return;
      case 'invite':
        this.set({ invites: [...this.state.invites.filter((i) => i.from !== msg.from), { from: msg.from, code: msg.code }] });
        return;
      case 'error':
        if (SOCIAL_ERRORS.includes(msg.code)) {
          if (msg.code === 'bad_session') {
            // The saved login was ended elsewhere: carry on as a guest.
            this.accountToken = null;
            clearAccountToken(this.deps.storage);
            this.set({ account: null, accountPending: false, friends: null });
            return;
          }
          this.set({ socialError: { code: msg.code, message: msg.message }, accountPending: false });
          return;
        }
        if (this.rejoinPending && DEAD_SESSION.includes(msg.code)) {
          this.rejoinPending = false;
          this.dropSession('rejoinFailed');
          return;
        }
        if (this.rejoinPending) this.rejoined();
        this.set({ error: { code: msg.code, message: msg.message }, acting: false });
        return;
      case 'closed':
        this.dropSession(msg.reason);
        return;
      case 'reaction':
        if (this.state.code) this.reactionListeners.forEach((f) => f({ seatId: msg.seatId, seat: msg.seat, reaction: msg.reaction }));
        return;
    }
  }

  private onGame(msg: GameMsg): void {
    // A finished game followed by a fresh one (play again): nothing carries over.
    const restart = !!this.state.game?.result && !msg.result;
    const prev = restart ? null : (this.state.game?.view ?? null);
    const added = termDuels(prev, msg.view);
    const duels = added && prev ? { term: prev.term, view: msg.view, deltas: added[msg.view.me]?.deltas ?? [] } : restart ? null : this.state.duels;
    this.set({ game: msg, prevView: prev, duels, lobby: null, acting: false });
  }

  private rejoined(): void {
    if (this.state.restoring) this.set({ restoring: false });
    if (!this.rejoinPending) return;
    this.rejoinPending = false;
    this.flushQueue();
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== OPEN) return;
    const q = this.queue;
    this.queue = [];
    q.forEach((m) => this.raw(m));
  }

  private dropSession(notice: Notice): void {
    this.session = null;
    this.rejoinPending = false;
    // Moves for the lost room are meaningless now; creating or joining a new room still makes sense.
    this.queue = this.queue.filter((m) => m.t === 'create' || m.t === 'join' || isSocialMessage(m));
    // Replaced: another tab or device holds the seat now and may share this storage, so leave it alone.
    if (notice !== 'replaced') clearSession(this.deps.storage);
    this.soloPlan = null;
    this.set({ seatId: null, code: null, hostId: null, lobby: null, game: null, prevView: null, duels: null, acting: false, restoring: false, notice });
    this.flushQueue();
  }

  private runSoloPlan(lobby: LobbyState): void {
    const plan = this.soloPlan;
    if (!plan || lobby.hostId !== this.state.seatId || lobby.seats.length !== 1) return;
    this.soloPlan = null;
    for (let i = 0; i < plan.bots; i++) this.send({ t: 'addBot', level: plan.level });
    this.send({ t: 'start' });
  }

  // ---------- sending ----------

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private raw(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === OPEN && !this.rejoinPending) this.raw(msg);
    else this.queue.push(msg);
  }

  create(name: string): void {
    this.set({ notice: null, error: null });
    this.send({ t: 'create', name });
  }

  join(code: string, name: string): void {
    this.set({ notice: null, error: null });
    this.send({ t: 'join', code, name });
  }

  /** Create a room, fill it with bots and start as soon as the lobby arrives. */
  solo(name: string, bots: number, level: BotLevel): void {
    this.soloPlan = { bots, level };
    this.create(name);
  }

  /** Look for strangers to play with; size null means any table. */
  quickMatch(name: string, size: QuickSize): void {
    this.quickReq = { t: 'quickMatch', name, size };
    this.set({ notice: null, error: null, quick: { size, searching: 0, since: this.now() } });
    // Not open yet: onOpen sends it.
    if (this.ws?.readyState === OPEN && !this.rejoinPending) this.raw(this.quickReq);
  }

  quickCancel(): void {
    if (!this.quickReq) return;
    this.quickReq = null;
    this.set({ quick: null });
    this.send({ t: 'quickCancel' });
  }

  /** Stop searching and play now against Normal bots. */
  quickBots(): void {
    if (!this.quickReq) return;
    this.send({ t: 'quickBots' });
  }

  leave(): void {
    this.send({ t: 'leave' });
  }

  setSeat(patch: SeatPatch): void {
    this.send({ t: 'setSeat', ...patch });
  }

  addBot(level: BotLevel): void {
    this.send({ t: 'addBot', level });
  }

  removeSeat(seatId: SeatId): void {
    this.send({ t: 'removeSeat', seatId });
  }

  setBotLevel(seatId: SeatId, level: BotLevel): void {
    this.send({ t: 'setBotLevel', seatId, level });
  }

  updateSettings(settings: Partial<RoomSettings>): void {
    this.send({ t: 'settings', settings });
  }

  startGame(): void {
    this.send({ t: 'start' });
  }

  /** Send one pick; further picks are ignored until the server answers. */
  act(action: Action): void {
    if (this.state.acting || !this.state.game) return;
    this.set({ acting: true });
    this.send({ t: 'act', action });
  }

  /** After the game, host: back to the lobby to change seats. */
  rematch(): void {
    this.send({ t: 'rematch' });
  }

  /** After the game: I am (not) ready to play again at the same table. */
  playAgain(ready = true): void {
    this.send({ t: 'playAgain', ready });
  }

  /** After the game, host: start the next game now. */
  playAgainNow(): void {
    this.send({ t: 'playAgainNow' });
  }

  /** Pick my account avatar (null: the default). */
  setAvatar(avatar: Avatar | null): void {
    this.set({ avatar });
    this.send({ t: 'setAvatar', avatar });
  }

  /** Send a quick reaction now, or not at all: a stale cheer after a reconnect would be odd. */
  react(reaction: ReactionId): void {
    if (this.state.seatId && this.ws?.readyState === OPEN && !this.rejoinPending) this.raw({ t: 'react', reaction });
  }

  // ---------- accounts and friends ----------

  signup(username: string, password: string): void {
    this.set({ accountPending: true, socialError: null });
    this.send({ t: 'signup', username, password });
  }

  login(username: string, password: string): void {
    this.set({ accountPending: true, socialError: null });
    this.send({ t: 'login', username, password });
  }

  logout(): void {
    this.send({ t: 'logout' });
  }

  requestFriend(username: string): void {
    this.set({ socialError: null });
    this.send({ t: 'friendRequest', username });
  }

  acceptFriend(username: string): void {
    this.send({ t: 'friendAccept', username });
  }

  /** Decline, cancel or unfriend. */
  removeFriend(username: string): void {
    this.send({ t: 'friendRemove', username });
  }

  /** Let the server notify this device (subscription from the browser's PushManager). */
  savePush(sub: PushSub): void {
    this.send({ t: 'pushSubscribe', sub });
  }

  removePush(endpoint: string): void {
    this.send({ t: 'pushUnsubscribe', endpoint });
  }

  /** Invite a friend to the room I am in. */
  invite(username: string): void {
    this.set({ socialError: null });
    this.send({ t: 'invite', username });
  }

  /** Join the room of an invite (leaving the current lobby, if any). */
  acceptInvite(invite: Invite, name: string): void {
    this.set({ invites: this.state.invites.filter((i) => i !== invite) });
    this.join(invite.code, name);
  }

  dismissInvite(invite: Invite): void {
    this.set({ invites: this.state.invites.filter((i) => i !== invite) });
  }

  requestProfile(): void {
    this.send({ t: 'profile' });
  }

  requestLeaderboard(): void {
    this.send({ t: 'leaderboard' });
  }

  changePassword(current: string, next: string): void {
    this.set({ accountPending: true, socialError: null, passwordChanged: false });
    this.send({ t: 'changePassword', current, next });
  }

  /** End every login of this account, here included. */
  logoutAll(): void {
    this.send({ t: 'logoutAll' });
  }

  deleteAccount(password: string): void {
    this.set({ accountPending: true, socialError: null });
    this.send({ t: 'deleteAccount', password });
  }

  clearSocialError(): void {
    this.set({ socialError: null });
  }

  clearError(): void {
    this.set({ error: null });
  }

  clearDuels(): void {
    this.set({ duels: null });
  }

  clearNotice(): void {
    this.set({ notice: null });
  }
}
