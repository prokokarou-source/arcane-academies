/**
 * Wire protocol between the Arcane Academies server and its clients.
 * Clients send intentions (ClientMessage); the server answers with ServerMessage.
 * Imported by both the server and the client, so it holds no server logic.
 */
import { RESOURCES } from '@arcane/engine';
import type { Action, BotLevel, PaymentPlan, PlayerView, Resource, ScoreBreakdown } from '@arcane/engine';

export type SeatId = string;

export interface RoomSettings {
  /** How long a disconnected player's seat waits before a bot takes over (lobby: before the seat is freed). */
  graceMs: number;
  /** Optional per-turn time limit; when it runs out, unsubmitted seats get an automatic pick. */
  turnTimerMs: number | null;
}

/** Inclusive [min, max] ranges the host may choose. */
export const SETTINGS_LIMITS = {
  graceMs: [10_000, 600_000],
  turnTimerMs: [15_000, 300_000],
} as const;

export const DEFAULT_SETTINGS: RoomSettings = { graceMs: 60_000, turnTimerMs: null };

export const MAX_NAME = 20;
export const MAX_MESSAGE_BYTES = 16_384;

export interface LobbySeat {
  id: SeatId;
  kind: 'human' | 'bot';
  name: string;
  botLevel?: BotLevel;
  academyId: string | null;
  side: 'A' | 'B';
  connected: boolean;
}

export interface LobbyState {
  code: string;
  inviteUrl: string;
  hostId: SeatId;
  seats: LobbySeat[];
  settings: RoomSettings;
}

/** Presence of an engine seat during a game. */
export interface SeatStatus {
  seat: number;
  name: string;
  kind: 'human' | 'bot' | 'archmage';
  connected: boolean;
  botControlled: boolean;
}

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'leave' }
  | { t: 'setSeat'; seatId?: SeatId; name?: string; academyId?: string | null; side?: 'A' | 'B' }
  | { t: 'addBot'; level: BotLevel }
  | { t: 'removeSeat'; seatId: SeatId }
  | { t: 'setBotLevel'; seatId: SeatId; level: BotLevel }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'act'; action: Action }
  | { t: 'rematch' };

export type ErrorCode =
  | 'bad_message'
  | 'no_room'
  | 'room_full'
  | 'not_in_room'
  | 'not_host'
  | 'bad_token'
  | 'bad_seat'
  | 'academy_taken'
  | 'unknown_academy'
  | 'bad_settings'
  | 'wrong_phase'
  | 'seat_count'
  | 'illegal_action';

export type CloseReason = 'expired' | 'replaced' | 'left' | 'removed';

export interface GameResult {
  scores: ScoreBreakdown[];
  winners: number[];
}

export type ServerMessage =
  | { t: 'joined'; code: string; seatId: SeatId; token: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'game'; view: PlayerView; legal: Action[]; seats: SeatStatus[]; deadline: number | null; result?: GameResult }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'closed'; reason: CloseReason };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

// ---------- validation ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000;
const LEVELS: readonly string[] = ['easy', 'normal', 'hard'];
const isLevel = (v: unknown): v is BotLevel => typeof v === 'string' && LEVELS.includes(v);

function name(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.trim();
  return n.length > 0 && n.length <= MAX_NAME ? n : null;
}

function resources(v: unknown): Partial<Record<Resource, number>> | null {
  if (!isObj(v)) return null;
  const out: Partial<Record<Resource, number>> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!(RESOURCES as readonly string[]).includes(k) || !isCount(n)) return null;
    out[k as Resource] = n;
  }
  return out;
}

function payment(v: unknown): PaymentPlan | null {
  if (!isObj(v)) return null;
  const buyLeft = resources(v.buyLeft);
  const buyRight = resources(v.buyRight);
  const { coinsToLeft, coinsToRight, coinsToBank, free } = v;
  if (!buyLeft || !buyRight || !isCount(coinsToLeft) || !isCount(coinsToRight) || !isCount(coinsToBank) || typeof free !== 'boolean') {
    return null;
  }
  return { buyLeft, buyRight, coinsToLeft, coinsToRight, coinsToBank, free };
}

function action(v: unknown): Action | null {
  if (!isObj(v) || !isStr(v.cardUid)) return null;
  const cardUid = v.cardUid;
  switch (v.type) {
    case 'sell':
    case 'chronoKeep':
      return { type: v.type, cardUid };
    case 'build':
    case 'tower': {
      const p = payment(v.payment);
      return p ? { type: v.type, cardUid, payment: p } : null;
    }
    default:
      return null;
  }
}

function settings(v: unknown): Partial<RoomSettings> | null {
  if (!isObj(v)) return null;
  const out: Partial<RoomSettings> = {};
  if ('graceMs' in v) {
    if (!Number.isInteger(v.graceMs)) return null;
    out.graceMs = v.graceMs as number;
  }
  if ('turnTimerMs' in v) {
    if (v.turnTimerMs !== null && !Number.isInteger(v.turnTimerMs)) return null;
    out.turnTimerMs = v.turnTimerMs as number | null;
  }
  return out;
}

function parseObj(m: Obj): ClientMessage | null {
  switch (m.t) {
    case 'create': {
      const n = name(m.name);
      return n ? { t: 'create', name: n } : null;
    }
    case 'join': {
      const n = name(m.name);
      return n && isStr(m.code, 16) ? { t: 'join', code: m.code, name: n } : null;
    }
    case 'rejoin':
      return isStr(m.code, 16) && isStr(m.token, 128) ? { t: 'rejoin', code: m.code, token: m.token } : null;
    case 'leave':
    case 'start':
    case 'rematch':
      return { t: m.t };
    case 'setSeat': {
      const out: Extract<ClientMessage, { t: 'setSeat' }> = { t: 'setSeat' };
      if (m.seatId !== undefined) {
        if (!isStr(m.seatId)) return null;
        out.seatId = m.seatId;
      }
      if (m.name !== undefined) {
        const n = name(m.name);
        if (!n) return null;
        out.name = n;
      }
      if (m.academyId !== undefined) {
        if (m.academyId !== null && !isStr(m.academyId)) return null;
        out.academyId = m.academyId;
      }
      if (m.side !== undefined) {
        if (m.side !== 'A' && m.side !== 'B') return null;
        out.side = m.side;
      }
      return out;
    }
    case 'addBot':
      return isLevel(m.level) ? { t: 'addBot', level: m.level } : null;
    case 'removeSeat':
      return isStr(m.seatId) ? { t: 'removeSeat', seatId: m.seatId } : null;
    case 'setBotLevel':
      return isStr(m.seatId) && isLevel(m.level) ? { t: 'setBotLevel', seatId: m.seatId, level: m.level } : null;
    case 'settings': {
      const s = settings(m.settings);
      return s ? { t: 'settings', settings: s } : null;
    }
    case 'act': {
      const a = action(m.action);
      return a ? { t: 'act', action: a } : null;
    }
    default:
      return null;
  }
}

/** Parse and validate one raw client frame. Returns null for anything malformed; never throws. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return isObj(data) ? parseObj(data) : null;
}
