/**
 * The connection to the game server and everything the screens need to know about it.
 * Framework-free: sockets, storage and timers are injected so tests can drive it.
 */
import type { Action, BotLevel, PlayerView } from '@arcane/engine';
import type { ClientMessage, ErrorCode, LobbyState, RoomSettings, SeatId, ServerMessage } from '@arcane/protocol';
import { termDuels } from '../game/derive';
import { clearSession, loadSession, saveSession } from './session';

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
}

export interface ClientDeps {
  url: string;
  createSocket(url: string): SocketLike;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
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
}

const OPEN = 1;
const MIN_BACKOFF = 500;
const MAX_BACKOFF = 8000;
const CLOSE_NOTICE: Record<number, Notice> = { 4001: 'replaced', 4002: 'expired' };
const DEAD_SESSION: ErrorCode[] = ['no_room', 'bad_token', 'not_in_room'];

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
};

export class GameClient {
  private state: ClientState = INITIAL;
  private listeners = new Set<() => void>();
  private ws: SocketLike | null = null;
  private queue: ClientMessage[] = [];
  private backoff = MIN_BACKOFF;
  private timer: unknown = null;
  private stopped = false;
  private rejoinPending = false;
  private soloPlan: { bots: number; level: BotLevel } | null = null;

  constructor(private readonly deps: ClientDeps) {}

  // ---------- store ----------

  getState = (): ClientState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  // ---------- lifecycle ----------

  start(): void {
    this.stopped = false;
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
    ws.onclose = (ev) => {
      if (ws === this.ws) this.onClose(ev.code);
    };
  }

  private onOpen(): void {
    this.backoff = MIN_BACKOFF;
    this.set({ conn: 'open' });
    const session = loadSession(this.deps.storage);
    if (session) {
      this.rejoinPending = true;
      this.raw({ t: 'rejoin', code: session.code, token: session.token });
    }
    const q = this.queue;
    this.queue = [];
    q.forEach((m) => this.raw(m));
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
        this.rejoinPending = false;
        saveSession(this.deps.storage, { code: msg.code, token: msg.token });
        this.set({ seatId: msg.seatId, code: msg.code, notice: null, error: null });
        return;
      case 'lobby':
        this.rejoinPending = false;
        this.set({ lobby: msg.lobby, hostId: msg.lobby.hostId, game: null, prevView: null, duels: null, acting: false });
        this.runSoloPlan(msg.lobby);
        return;
      case 'game':
        this.rejoinPending = false;
        this.onGame(msg);
        return;
      case 'error':
        if (this.rejoinPending && DEAD_SESSION.includes(msg.code)) {
          this.rejoinPending = false;
          this.dropSession('rejoinFailed');
          return;
        }
        this.set({ error: { code: msg.code, message: msg.message }, acting: false });
        return;
      case 'closed':
        this.dropSession(msg.reason);
        return;
    }
  }

  private onGame(msg: GameMsg): void {
    const prev = this.state.game?.view ?? null;
    const added = termDuels(prev, msg.view);
    const duels = added && prev ? { term: prev.term, view: msg.view, deltas: added[msg.view.me]?.deltas ?? [] } : this.state.duels;
    this.set({ game: msg, prevView: prev, duels, lobby: null, acting: false });
  }

  private dropSession(notice: Notice): void {
    clearSession(this.deps.storage);
    this.soloPlan = null;
    this.set({ seatId: null, code: null, hostId: null, lobby: null, game: null, prevView: null, duels: null, acting: false, notice });
  }

  private runSoloPlan(lobby: LobbyState): void {
    const plan = this.soloPlan;
    if (!plan || lobby.hostId !== this.state.seatId || lobby.seats.length !== 1) return;
    this.soloPlan = null;
    for (let i = 0; i < plan.bots; i++) this.send({ t: 'addBot', level: plan.level });
    this.send({ t: 'start' });
  }

  // ---------- sending ----------

  private raw(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === OPEN) this.raw(msg);
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

  rematch(): void {
    this.send({ t: 'rematch' });
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
