/**
 * A solo game against bots, run entirely in the browser: no server, so it works offline
 * and starts at once even while the host sleeps. It speaks the same 'game' message the
 * server sends, so the screens cannot tell the difference.
 */
import {
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
import type { SeatStatus, ServerMessage } from '@arcane/protocol';

type GameMsg = Extract<ServerMessage, { t: 'game' }>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What a reload needs to pick the game up again. */
export interface LocalSave {
  v: 1;
  name: string;
  bots: number;
  level: BotLevel;
  state: GameState;
}

export interface LocalDeps {
  storage: Store;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** Uniform in [0, 1); Math.random when not given. */
  random?(): number;
  emit(msg: GameMsg): void;
}

const KEY = 'arcane.local';
/** The human always sits first, which is engine seat 0 (with 2 seats the Archmage takes seat 1). */
const ME = 0;
/** Bots "think" for a moment so turns do not snap past. */
const BOT_DELAY = 700;
const BOT_JITTER = 600;

export function loadLocal(storage: Store): LocalSave | null {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as Partial<LocalSave> | null;
    if (!v || v.v !== 1 || typeof v.name !== 'string' || !v.state || !Array.isArray(v.state.players)) return null;
    return v as LocalSave;
  } catch {
    return null;
  }
}

function saveLocal(storage: Store, s: LocalSave | null): void {
  try {
    if (s) storage.setItem(KEY, JSON.stringify(s));
    else storage.removeItem(KEY);
  } catch {
    // Private mode or full storage: the game goes on, only resume-after-reload is lost.
  }
}

export class LocalGame {
  private timer: unknown = null;
  private stopped = false;

  private constructor(
    private readonly deps: LocalDeps,
    private save: LocalSave,
  ) {}

  static start(deps: LocalDeps, name: string, bots: number, level: BotLevel): LocalGame {
    const g = new LocalGame(deps, { v: 1, name, bots, level, state: newState(deps, name, bots, level) });
    g.step();
    return g;
  }

  static resume(deps: LocalDeps, save: LocalSave): LocalGame {
    const g = new LocalGame(deps, save);
    g.step();
    return g;
  }

  /** Submit my pick; returns an error message when the engine refuses it. */
  act(action: Action): string | null {
    const s = this.save.state;
    if (s.phase === 'ended') return 'The game has ended';
    try {
      this.save = { ...this.save, state: submitAction(s, ME, action) };
    } catch (e) {
      return e instanceof Error ? e.message : 'Illegal action';
    }
    this.step();
    return null;
  }

  /** A fresh game with the same name, bots and level. */
  rematch(): void {
    this.cancel();
    const { name, bots, level } = this.save;
    this.save = { ...this.save, state: newState(this.deps, name, bots, level) };
    this.step();
  }

  /** End the game for good and forget it. */
  stop(): void {
    this.stopped = true;
    this.cancel();
    saveLocal(this.deps.storage, null);
  }

  /** Pause without forgetting (the page is going away). */
  detach(): void {
    this.stopped = true;
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Publish the state, then let the bots move (and the turn resolve) after a short pause. */
  private step(): void {
    if (this.stopped) return;
    const s = this.save.state;
    saveLocal(this.deps.storage, this.save);
    this.deps.emit(message(s));
    if (s.phase === 'ended' || this.timer !== null) return;
    const botsToMove = actingSeats(s).some((seat) => seat !== ME && !s.players[seat].pending);
    if (!botsToMove && !allSubmitted(s)) return; // waiting for me
    const delay = BOT_DELAY + Math.floor((this.deps.random?.() ?? Math.random()) * BOT_JITTER);
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      let next = autoPick(this.save.state);
      if (allSubmitted(next)) next = resolveTurn(next);
      this.save = { ...this.save, state: next };
      this.step();
    }, delay);
  }
}

function newState(deps: LocalDeps, name: string, bots: number, level: BotLevel): GameState {
  const seats: SeatConfig[] = [
    { kind: 'human', name, side: 'A' },
    ...Array.from({ length: bots }, (_, i): SeatConfig => ({ kind: 'bot', name: `Bot ${i + 1}`, side: 'A', botLevel: level })),
  ];
  const seed = Math.floor((deps.random?.() ?? Math.random()) * (2 ** 31 - 1));
  return createGame({ seed, seats });
}

/** Every seat but mine picks, exactly as the server's bots do. */
function autoPick(s: GameState): GameState {
  let next = s;
  for (const seat of actingSeats(next)) {
    const p = next.players[seat];
    if (seat === ME || p.pending) continue;
    if (p.config.kind === 'archmage') next = submitAction(next, seat, archmagePick(next, seat));
    else next = submitAction(next, seat, botPick(next, seat, p.config.botLevel ?? 'normal'));
  }
  return next;
}

function message(s: GameState): GameMsg {
  const seats: SeatStatus[] = s.players.map((p) => ({ seat: p.seat, name: p.config.name, kind: p.config.kind, connected: true, botControlled: false }));
  const legal = s.players[ME].pending || s.phase === 'ended' ? [] : legalActions(s, ME);
  const result = s.phase === 'ended' ? { scores: finalScores(s), winners: winners(s) } : undefined;
  return { t: 'game', view: viewFor(s, ME), legal, seats, deadline: null, ...(result ? { result } : {}) };
}
