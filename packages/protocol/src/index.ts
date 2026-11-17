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

/** Account avatars: an emblem drawn in one of the theme colours. */
export const AVATAR_ICONS = [
  'owl', 'flame', 'wave', 'leaf', 'star', 'moon', 'key', 'crown',
  'quill', 'eye', 'hourglass', 'rune', 'crystal', 'tower', 'comet', 'mask',
] as const;
export const AVATAR_COLORS = ['gold', 'ember', 'rose', 'violet', 'azure', 'teal', 'moss', 'silver'] as const;
export type AvatarIcon = (typeof AVATAR_ICONS)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];
export interface Avatar {
  icon: AvatarIcon;
  color: AvatarColor;
}

export function isAvatar(v: unknown): v is Avatar {
  if (typeof v !== 'object' || v === null) return false;
  const { icon, color } = v as Record<string, unknown>;
  return (AVATAR_ICONS as readonly unknown[]).includes(icon) && (AVATAR_COLORS as readonly unknown[]).includes(color);
}

/** Stored as "icon:color"; anything else reads as no avatar. */
export const avatarKey = (a: Avatar): string => `${a.icon}:${a.color}`;
export function parseAvatarKey(s: string | null | undefined): Avatar | null {
  if (!s) return null;
  const [icon, color] = s.split(':');
  const a = { icon, color };
  return isAvatar(a) ? a : null;
}

// ---------- menu: queues and rooms (contract sections Q and R) ----------

/** One side for the whole table: every seat plays side A, or every seat side B. */
export type Side = 'A' | 'B';
/** The host's choice for the table; 'random' is drawn at game start. */
export type SideMode = Side | 'random';
export const SIDE_MODES: readonly SideMode[] = ['A', 'B', 'random'];
/** Casual / Ranked tables: 1v1 = 2 humans + the Rival Archmage. */
export type Queue = '1v1' | '3-5' | '6-7';
export const QUEUES: readonly Queue[] = ['1v1', '3-5', '6-7'];
export type QueueKind = 'casual' | 'ranked';
/** 'bots' = solo in the browser, 'room' = host-made room. */
export type GameKind = 'bots' | 'casual' | 'ranked' | 'room';

/** A host-made room's setup, chosen before the lobby and changeable there. */
export interface RoomConfig {
  sideMode: SideMode;
  turnTimerMs: number | null;
  /** Total seats, humans and bots: 2..7. */
  seats: number;
  /** Listed in Open Rooms (else code / invite only). */
  public: boolean;
  /** Bot seats, 0..seats-1. */
  bots: number;
  /** One level for every bot. */
  botLevel: BotLevel;
}

export const ROOM_SEATS = [2, 7] as const;
export const DEFAULT_ROOM_CONFIG: RoomConfig = { sideMode: 'random', turnTimerMs: null, seats: 7, public: false, bots: 0, botLevel: 'normal' };

/** A public room in its lobby with a free human seat. */
export interface OpenRoom {
  code: string;
  /** The host's name. */
  host: string;
  sideMode: SideMode;
  turnTimerMs: number | null;
  seats: number;
  /** Seats filled (humans and bots). */
  taken: number;
  bots: number;
}

/** Sent once per game, with its first `game` message: the drawn side and academies, for the reveal animation. */
export interface GameReveal {
  side: Side;
  academies: { seat: number; academyId: string }[];
}

export interface LobbySeat {
  id: SeatId;
  kind: 'human' | 'bot';
  name: string;
  botLevel?: BotLevel;
  academyId: string | null;
  connected: boolean;
  /** The account playing this seat, when its player is logged in. */
  username?: string;
  /** Logged-in players' chosen avatar; absent for guests and bots. */
  avatar?: Avatar;
}

export interface LobbyState {
  code: string;
  inviteUrl: string;
  hostId: SeatId;
  seats: LobbySeat[];
  settings: RoomSettings;
  /** The room's setup (queue rooms: what the queue decided). */
  config: RoomConfig;
  /** What made this room: a Casual/Ranked queue or a host. */
  kind: 'casual' | 'ranked' | 'room';
  queue?: Queue;
  /** Queue rooms: the game starts by itself at this server time (epoch ms). */
  startsAt?: number | null;
  /** Made by a queue: strangers, so nobody can remove anybody and academies are drawn. */
  quick?: boolean;
}

/** Presence of an engine seat during a game. */
export interface SeatStatus {
  seat: number;
  name: string;
  kind: 'human' | 'bot' | 'archmage';
  connected: boolean;
  botControlled: boolean;
  /** The account playing this seat, when its player is logged in. */
  username?: string;
  /** Logged-in players' chosen avatar; absent for guests and bots. */
  avatar?: Avatar;
  /** The room's host (who may start the rematch early). */
  host?: boolean;
  /** After the game: tapped "Play again". */
  ready?: boolean;
}

/** Usernames: 3–20 letters, digits or underscores; unique ignoring case. */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const MIN_PASSWORD = 6;
export const MAX_PASSWORD = 128;

export interface FriendInfo {
  username: string;
  online: boolean;
  avatar?: Avatar;
}

/** My friend list: accepted friends plus requests waiting on either side. */
export interface FriendList {
  friends: FriendInfo[];
  /** People who asked to be my friend. */
  incoming: string[];
  /** People I asked, still waiting. */
  outgoing: string[];
}

/** (Side, Queue, QUEUES and GameKind are defined with the queues and rooms above.) */
export const GAME_KINDS: readonly GameKind[] = ['bots', 'casual', 'ranked', 'room'];
export type Division = 'apprentice' | 'adept' | 'magister' | 'archmage';
/** Leaderboard scopes; continent and country follow my own account's country. */
export type Scope = 'friends' | 'global' | 'continent' | 'country';
export const SCOPES: readonly Scope[] = ['friends', 'global', 'continent', 'country'];

/** Every ranked rating starts here. */
export const START_RATING = 1000;
/** Rating bands: <1100 apprentice, 1100–1299 adept, 1300–1499 magister, >=1500 archmage. No rating yet = apprentice. */
export function divisionOf(rating: number | null): Division {
  if (rating === null || rating < 1100) return 'apprentice';
  if (rating < 1300) return 'adept';
  if (rating < 1500) return 'magister';
  return 'archmage';
}

export type Continent = 'africa' | 'antarctica' | 'asia' | 'europe' | 'north-america' | 'oceania' | 'south-america';
const CONTINENT_CODES: Record<Continent, string> = {
  africa:
    'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW',
  antarctica: 'AQ BV GS HM TF',
  asia: 'AF AM AZ BH BD BT BN KH CN GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE IO',
  europe:
    'AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA AX',
  'north-america':
    'AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI',
  oceania: 'AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF CX CC UM',
  'south-america': 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE',
};
/** ISO 3166-1 alpha-2 country code → continent (static; the server and the client agree on it). */
export const COUNTRY_CONTINENT: Readonly<Record<string, Continent>> = Object.fromEntries(
  (Object.entries(CONTINENT_CODES) as [Continent, string][]).flatMap(([c, codes]) => codes.split(' ').map((code) => [code, c])),
);
export const isCountry = (v: unknown): v is string => typeof v === 'string' && Object.hasOwn(COUNTRY_CONTINENT, v);
export const continentOf = (country: string | null | undefined): Continent | null =>
  country && isCountry(country) ? COUNTRY_CONTINENT[country] : null;
export const countriesIn = (c: Continent): string[] => CONTINENT_CODES[c].split(' ');

/** One leaderboard row. `rank` and `rating` are null before a first ranked game in that queue. */
export interface LeaderRow {
  rank: number | null;
  username: string;
  country: string | null;
  avatar?: Avatar;
  division: Division;
  rating: number | null;
  games: number;
}
export const LEADERBOARD_SIZE = 100;
export const MAX_SEARCH = 20;

/** One finished game in a profile's recent list. */
export interface RecentGame {
  /** Epoch ms. */
  at: number;
  kind: GameKind;
  queue?: Queue;
  academyId: string;
  side: Side;
  /** 1 = first (shared on a tie). */
  place: number;
  score: number;
  /** Seats in the game, bots included. */
  players: number;
  /** Ranked games: my rating change. */
  ratingDelta?: number;
}

export interface Profile {
  username: string;
  avatar?: Avatar;
  country: string | null;
  /** Epoch ms of signup. */
  memberSince: number;
  /** True for my own profile (others are read-only). */
  me: boolean;
  ranked: { queue: Queue; rating: number | null; division: Division; rank: number | null; countryRank: number | null }[];
  totals: { games: number; wins: number; totalScore: number; bestScore: number; streak: number; bestStreak: number };
  /** Bot and room games count as casual. */
  byKind: { casual: { games: number; wins: number }; ranked: { games: number; wins: number } };
  academies: { academyId: string; games: number; wins: number }[];
  /** The last games, newest first. */
  recent: RecentGame[];
}

export const PROFILE_HISTORY = 10;

/** Why a player is reported. */
export const REPORT_REASONS = ['cheating', 'name', 'harassment', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const MAX_REPORT_NOTE = 200;

/** Recovery codes: RECOVERY_GROUPS groups of 4 from an alphabet without look-alikes (no 0/O, 1/I/L). */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_GROUPS = 4;
/** Uppercase, without spaces or dashes: what the server hashes and compares. */
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A browser push subscription (PushSubscription.toJSON()), saved so the server can notify a closed app. */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Account and friend messages; handled apart from rooms and never tied to a seat. */
export type SocialMessage =
  | { t: 'signup'; username: string; password: string }
  | { t: 'login'; username: string; password: string }
  /** Resume a saved login (the token from 'account'). */
  | { t: 'auth'; token: string }
  | { t: 'logout' }
  | { t: 'friendRequest'; username: string }
  | { t: 'friendAccept'; username: string }
  /** Decline a request, cancel my own, or unfriend. */
  | { t: 'friendRemove'; username: string }
  /** Invite an online friend to the room I am in. */
  | { t: 'invite'; username: string }
  /** My profile, or another player's (read-only) by username. */
  | { t: 'profile'; username?: string }
  /** Top rows of a ranked queue in a scope, optionally filtered by a username search. */
  | { t: 'leaderboard'; queue: Queue; scope: Scope; search?: string }
  /** My country (ISO 3166-1 alpha-2), or null to clear it. */
  | { t: 'setCountry'; country: string | null }
  | { t: 'changePassword'; current: string; next: string }
  /** End every login of my account, this one included. */
  | { t: 'logoutAll' }
  | { t: 'deleteAccount'; password: string }
  /** Invite a friend to the room I am in (online, or offline with notifications on). */
  | { t: 'invite'; username: string }
  /** Notify this device (logged-in user) about invites and friend requests while the app is closed. */
  | { t: 'pushSubscribe'; sub: PushSub }
  | { t: 'pushUnsubscribe'; endpoint: string }
  /** Block an account: ends any friendship, hides invites, requests and reactions, never quick-matched together. */
  | { t: 'block'; username: string }
  | { t: 'unblock'; username: string }
  /** Report an account (the room I am in is added by the server). */
  | { t: 'report'; username: string; reason: ReportReason; note: string }
  /** Forgot password: the recovery code sets a new password and logs in. */
  | { t: 'recover'; username: string; code: string; password: string }
  /** Make a new recovery code for my account (replaces the old one). */
  | { t: 'createRecoveryCode'; password: string }
  /** Pick my avatar (null: back to the default). */
  | { t: 'setAvatar'; avatar: Avatar | null };

export const SOCIAL_TYPES: readonly SocialMessage['t'][] = [
  'signup',
  'login',
  'auth',
  'logout',
  'friendRequest',
  'friendAccept',
  'friendRemove',
  'invite',
  'profile',
  'leaderboard',
  'changePassword',
  'logoutAll',
  'deleteAccount',
  'pushSubscribe',
  'pushUnsubscribe',
  'block',
  'unblock',
  'report',
  'recover',
  'createRecoveryCode',
  'setAvatar',
  'setCountry',
];

export const isSocialMessage = (m: ClientMessage): m is SocialMessage => (SOCIAL_TYPES as readonly string[]).includes(m.t);

/** Quick reactions: a fixed set, so strangers can cheer without free text. */
export const REACTIONS = ['clap', 'wow', 'laugh', 'fire', 'think', 'goodMove', 'hurry', 'gg'] as const;
export type ReactionId = (typeof REACTIONS)[number];
export const isReaction = (v: unknown): v is ReactionId => typeof v === 'string' && (REACTIONS as readonly string[]).includes(v);
/** Per-seat limit: a burst of REACTION_BURST, then one more every REACTION_REFILL_MS. */
export const REACTION_BURST = 3;
export const REACTION_REFILL_MS = 2_000;

export type ClientMessage =
  | SocialMessage
  /** A private room with the default setup (older clients); prefer createRoom. */
  | { t: 'create'; name: string }
  | { t: 'createRoom'; name: string; settings: RoomConfig }
  /** `join` is the older name of joinRoom. */
  | { t: 'join'; code: string; name: string }
  | { t: 'joinRoom'; code: string; name: string }
  /** Host in the lobby: change the room's setup. */
  | { t: 'roomConfig'; settings: Partial<RoomConfig> }
  /** Get the public room list now and on every change, until roomsUnwatch. */
  | { t: 'roomsWatch' }
  | { t: 'roomsUnwatch' }
  /** Search a Casual or Ranked table (leaves any room first). Ranked needs a login. */
  | { t: 'queueJoin'; kind: QueueKind; queue: Queue; name: string }
  | { t: 'queueLeave' }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'leave' }
  | { t: 'setSeat'; seatId?: SeatId; name?: string; academyId?: string | null }
  | { t: 'addBot'; level: BotLevel }
  | { t: 'removeSeat'; seatId: SeatId }
  | { t: 'setBotLevel'; seatId: SeatId; level: BotLevel }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'act'; action: Action }
  /** After the game, host only: back to the lobby to change seats. */
  | { t: 'rematch' }
  /** After the game: I want to play again with the same table (false: not any more). */
  | { t: 'playAgain'; ready: boolean }
  /** After the game, host only: start the next game now with whoever is ready. */
  | { t: 'playAgainNow' }
  | { t: 'react'; reaction: ReactionId };

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
  | 'illegal_action'
  // accounts and friends
  | 'bad_username'
  | 'bad_password'
  | 'username_taken'
  | 'bad_login'
  | 'bad_session'
  | 'too_many_attempts'
  | 'not_logged_in'
  | 'no_user'
  | 'not_friends'
  | 'friend_offline'
  | 'busy'
  | 'invite_no_room'
  | 'unavailable'
  | 'wrong_password'
  | 'bad_recovery';

/** Errors that belong to the account and friend screens rather than the room. */
export const SOCIAL_ERRORS: readonly ErrorCode[] = [
  'bad_username',
  'bad_password',
  'username_taken',
  'bad_login',
  'bad_session',
  'too_many_attempts',
  'not_logged_in',
  'no_user',
  'not_friends',
  'friend_offline',
  'busy',
  'invite_no_room',
  'unavailable',
  'wrong_password',
  'bad_recovery',
];

export type CloseReason = 'expired' | 'replaced' | 'left' | 'removed';

export interface GameResult {
  scores: ScoreBreakdown[];
  winners: number[];
}

export type ServerMessage =
  | { t: 'joined'; code: string; seatId: SeatId; token: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'game'; view: PlayerView; legal: Action[]; seats: SeatStatus[]; deadline: number | null; result?: GameResult; reveal?: GameReveal; kind?: 'casual' | 'ranked' | 'room' }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'closed'; reason: CloseReason }
  /** Someone in the room reacted. `seat` is their engine seat during a game, else null. */
  | { t: 'reaction'; seatId: SeatId; seat: number | null; reaction: ReactionId }
  /** Logged in (token only after signup/login, to be saved) or logged out (username null). */
  | { t: 'account'; username: string | null; token?: string; avatar?: Avatar | null }
  | { t: 'friends'; list: FriendList }
  /** A friend came online or went offline. */
  | { t: 'presence'; username: string; online: boolean }
  /** A friend invites me to their room. */
  | { t: 'invite'; from: string; code: string }
  /** I am in a queue: `searching` players wait in it (me included). Sent on every change. */
  | { t: 'queueState'; kind: QueueKind; queue: Queue; searching: number; waitedMs: number }
  /** I left the queue without a match. */
  | { t: 'queueLeft' }
  /** Open public rooms (on roomsWatch and on every change, at most about once a second). */
  | { t: 'rooms'; rooms: OpenRoom[] }
  | { t: 'profile'; profile: Profile }
  /** `me` is my own row (rank/rating null before my first ranked game); null for guests. */
  | { t: 'leaderboard'; queue: Queue; scope: Scope; rows: LeaderRow[]; me: LeaderRow | null }
  | { t: 'passwordChanged' }
  /** The server's VAPID public key after login; null when push notifications are off on the server. */
  | { t: 'pushKey'; key: string | null }
  /** Accounts I blocked, sent after login and after every change. */
  | { t: 'blocked'; list: string[] }
  /** A report was saved. */
  | { t: 'reported'; username: string }
  /** A new recovery code, shown once (after signup, recovery, or on request). */
  | { t: 'recoveryCode'; code: string };

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
const isQueue = (v: unknown): v is Queue => (QUEUES as readonly unknown[]).includes(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Shape only; the server checks ranges against the room (seats vs players already in it). */
function roomConfig(v: unknown): Partial<RoomConfig> | null {
  if (!isObj(v)) return null;
  const out: Partial<RoomConfig> = {};
  if (v.sideMode !== undefined) {
    if (!(SIDE_MODES as readonly unknown[]).includes(v.sideMode)) return null;
    out.sideMode = v.sideMode as SideMode;
  }
  if (v.turnTimerMs !== undefined) {
    if (v.turnTimerMs !== null && !isInt(v.turnTimerMs)) return null;
    out.turnTimerMs = v.turnTimerMs;
  }
  for (const k of ['seats', 'bots'] as const) {
    if (v[k] === undefined) continue;
    if (!isInt(v[k])) return null;
    out[k] = v[k] as number;
  }
  if (v.public !== undefined) {
    if (typeof v.public !== 'boolean') return null;
    out.public = v.public;
  }
  if (v.botLevel !== undefined) {
    if (!isLevel(v.botLevel)) return null;
    out.botLevel = v.botLevel;
  }
  return out;
}

const fullConfig = (c: Partial<RoomConfig>): c is RoomConfig =>
  c.sideMode !== undefined && c.turnTimerMs !== undefined && c.seats !== undefined && c.public !== undefined && c.bots !== undefined && c.botLevel !== undefined;

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

/** Shape only (strings of sane length); the server checks the username and password rules. */
const isUser = (v: unknown): v is string => isStr(v, 64);
const isPass = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_PASSWORD;
const isReportReason = (v: unknown): v is ReportReason => typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
const isEndpoint = (v: unknown): v is string => isStr(v, 2048) && v.startsWith('https://');

function pushSub(v: unknown): PushSub | null {
  if (!isObj(v) || !isEndpoint(v.endpoint) || !isObj(v.keys)) return null;
  const { p256dh, auth } = v.keys;
  return isStr(p256dh, 256) && isStr(auth, 64) ? { endpoint: v.endpoint, keys: { p256dh, auth } } : null;
}

function parseObj(m: Obj): ClientMessage | null {
  switch (m.t) {
    case 'signup':
    case 'login':
      return isUser(m.username) && isPass(m.password) ? { t: m.t, username: m.username, password: m.password } : null;
    case 'auth':
      return isStr(m.token, 128) ? { t: 'auth', token: m.token } : null;
    case 'logout':
    case 'logoutAll':
      return { t: m.t };
    case 'profile':
      if (m.username === undefined) return { t: 'profile' };
      return isUser(m.username) ? { t: 'profile', username: m.username } : null;
    case 'leaderboard': {
      if (!(QUEUES as readonly unknown[]).includes(m.queue) || !(SCOPES as readonly unknown[]).includes(m.scope)) return null;
      const out: Extract<ClientMessage, { t: 'leaderboard' }> = { t: 'leaderboard', queue: m.queue as Queue, scope: m.scope as Scope };
      if (m.search !== undefined) {
        if (typeof m.search !== 'string' || m.search.length > 64) return null;
        const q = m.search.trim().slice(0, MAX_SEARCH);
        if (q) out.search = q;
      }
      return out;
    }
    case 'setCountry':
      if (m.country === null) return { t: 'setCountry', country: null };
      return isCountry(m.country) ? { t: 'setCountry', country: m.country } : null;
    case 'changePassword':
      return isPass(m.current) && isPass(m.next) ? { t: 'changePassword', current: m.current, next: m.next } : null;
    case 'deleteAccount':
      return isPass(m.password) ? { t: 'deleteAccount', password: m.password } : null;
    case 'friendRequest':
    case 'friendAccept':
    case 'friendRemove':
    case 'invite':
      return isUser(m.username) ? { t: m.t, username: m.username } : null;
    case 'pushSubscribe': {
      const sub = pushSub(m.sub);
      return sub ? { t: 'pushSubscribe', sub } : null;
    }
    case 'pushUnsubscribe':
      return isEndpoint(m.endpoint) ? { t: 'pushUnsubscribe', endpoint: m.endpoint } : null;
    case 'block':
    case 'unblock':
      return isUser(m.username) ? { t: m.t, username: m.username } : null;
    case 'report': {
      const note = m.note === undefined ? '' : m.note;
      if (!isUser(m.username) || !isReportReason(m.reason) || typeof note !== 'string' || note.length > MAX_REPORT_NOTE) return null;
      return { t: 'report', username: m.username, reason: m.reason, note: note.trim() };
    }
    case 'recover':
      return isUser(m.username) && isStr(m.code, 64) && isPass(m.password)
        ? { t: 'recover', username: m.username, code: m.code, password: m.password }
        : null;
    case 'createRecoveryCode':
      return isPass(m.password) ? { t: 'createRecoveryCode', password: m.password } : null;
    case 'setAvatar':
      if (m.avatar === null) return { t: 'setAvatar', avatar: null };
      return isAvatar(m.avatar) ? { t: 'setAvatar', avatar: { icon: m.avatar.icon, color: m.avatar.color } } : null;
    case 'playAgain':
      return typeof m.ready === 'boolean' ? { t: 'playAgain', ready: m.ready } : null;
    case 'playAgainNow':
      return { t: 'playAgainNow' };
    case 'create': {
      const n = name(m.name);
      return n ? { t: 'create', name: n } : null;
    }
    case 'join':
    case 'joinRoom': {
      const n = name(m.name);
      return n && isStr(m.code, 16) ? { t: m.t, code: m.code, name: n } : null;
    }
    case 'createRoom': {
      const n = name(m.name);
      const c = roomConfig(m.settings);
      return n && c && fullConfig(c) ? { t: 'createRoom', name: n, settings: c } : null;
    }
    case 'roomConfig': {
      const c = roomConfig(m.settings);
      return c ? { t: 'roomConfig', settings: c } : null;
    }
    case 'queueJoin': {
      const n = name(m.name);
      const ok = n && (m.kind === 'casual' || m.kind === 'ranked') && isQueue(m.queue);
      return ok ? { t: 'queueJoin', kind: m.kind as QueueKind, queue: m.queue as Queue, name: n } : null;
    }
    case 'rejoin':
      return isStr(m.code, 16) && isStr(m.token, 128) ? { t: 'rejoin', code: m.code, token: m.token } : null;
    case 'leave':
    case 'start':
    case 'rematch':
    case 'queueLeave':
    case 'roomsWatch':
    case 'roomsUnwatch':
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
    case 'react':
      return isReaction(m.reaction) ? { t: 'react', reaction: m.reaction } : null;
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
