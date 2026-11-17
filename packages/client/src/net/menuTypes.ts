/**
 * The new menu's wire contract (menu-contract.md), copied here while the server side is built in parallel.
 * At merge time these are replaced by imports from '@arcane/protocol'.
 */
import type { BotLevel } from '@arcane/engine';
import type { Avatar, ClientMessage, LobbyState as BaseLobbyState, ServerMessage } from '@arcane/protocol';

export type Side = 'A' | 'B';
export type SideMode = 'A' | 'B' | 'random';
export type Queue = '1v1' | '3-5' | '6-7';
export type GameKind = 'bots' | 'casual' | 'ranked' | 'room';
export type Division = 'apprentice' | 'adept' | 'magister' | 'archmage';
export type Scope = 'friends' | 'global' | 'continent' | 'country';

export const QUEUES: readonly Queue[] = ['1v1', '3-5', '6-7'];
export const DIVISIONS: readonly Division[] = ['apprentice', 'adept', 'magister', 'archmage'];
export const START_RATING = 1000;

/** Rating bands: <1100 apprentice, 1100–1299 adept, 1300–1499 magister, >=1500 archmage. */
export function divisionOf(rating: number | null): Division {
  const r = rating ?? START_RATING;
  return r >= 1500 ? 'archmage' : r >= 1300 ? 'magister' : r >= 1100 ? 'adept' : 'apprentice';
}

export interface RoomConfig {
  sideMode: SideMode;
  turnTimerMs: number | null;
  /** 2..7 total seats (humans + bots). */
  seats: number;
  public: boolean;
  /** Bot seats, 0..seats-1. */
  bots: number;
  botLevel: BotLevel;
}

export const DEFAULT_ROOM: RoomConfig = { sideMode: 'random', turnTimerMs: null, seats: 4, public: true, bots: 0, botLevel: 'normal' };

export interface OpenRoom {
  code: string;
  host: string;
  sideMode: SideMode;
  turnTimerMs: number | null;
  seats: number;
  taken: number;
  bots: number;
}

export interface Reveal {
  side: Side;
  academies: { seat: number; academyId: string }[];
}

export interface LeaderRow {
  rank: number | null;
  username: string;
  country: string | null;
  avatar?: Avatar;
  division: Division;
  rating: number | null;
  games: number;
}

export interface Profile {
  username: string;
  avatar?: Avatar;
  country: string | null;
  memberSince: number;
  me: boolean;
  ranked: { queue: Queue; rating: number | null; division: Division; rank: number | null; countryRank: number | null }[];
  totals: { games: number; wins: number; totalScore: number; bestScore: number; streak: number; bestStreak: number };
  byKind: { casual: { games: number; wins: number }; ranked: { games: number; wins: number } };
  academies: { academyId: string; games: number; wins: number }[];
  recent: {
    at: number;
    kind: GameKind;
    queue?: Queue;
    academyId: string;
    side: Side;
    place: number;
    score: number;
    players: number;
    ratingDelta?: number;
  }[];
}

export type LobbyState = BaseLobbyState & { config?: RoomConfig };

export type MenuClientMessage =
  | { t: 'queueJoin'; kind: 'casual' | 'ranked'; queue: Queue; name: string }
  | { t: 'queueLeave' }
  | { t: 'roomsWatch' }
  | { t: 'roomsUnwatch' }
  | { t: 'createRoom'; name: string; settings: RoomConfig }
  | { t: 'joinRoom'; code: string; name: string }
  | { t: 'roomConfig'; settings: Partial<RoomConfig> }
  | { t: 'leaderboard'; queue: Queue; scope: Scope; search?: string }
  | { t: 'profile'; username?: string }
  | { t: 'setCountry'; country: string | null };

/** Old messages the new menu no longer sends (replaced by the ones above). */
type Replaced = 'quickMatch' | 'quickCancel' | 'quickBots' | 'profile' | 'leaderboard';
export type AnyClientMessage = Exclude<ClientMessage, { t: Replaced }> | MenuClientMessage;

type BaseGame = Extract<ServerMessage, { t: 'game' }>;
export type GameMsg = BaseGame & { reveal?: Reveal };

export type MenuServerMessage =
  | { t: 'queueState'; kind: 'casual' | 'ranked'; queue: Queue; searching: number; waitedMs: number }
  | { t: 'queueLeft' }
  | { t: 'rooms'; rooms: OpenRoom[] }
  | { t: 'leaderboard'; queue: Queue; scope: Scope; rows: LeaderRow[]; me: LeaderRow | null }
  | { t: 'profile'; profile: Profile }
  | { t: 'lobby'; lobby: LobbyState }
  | GameMsg;

export type AnyServerMessage =
  | Exclude<ServerMessage, { t: 'quickQueue' | 'quickCancelled' | 'profile' | 'leaderboard' | 'lobby' | 'game' }>
  | MenuServerMessage;

/** Continents for the leaderboard scope chip. */
export type Continent = 'europe' | 'asia' | 'africa' | 'north-america' | 'south-america' | 'oceania';

/** ISO-3166 alpha-2 countries offered in the profile, with their continent (static map, mirrors the protocol's). */
export const COUNTRIES: Record<string, Continent> = {
  // Europe
  AL: 'europe', AD: 'europe', AT: 'europe', BY: 'europe', BE: 'europe', BA: 'europe', BG: 'europe', HR: 'europe', CY: 'europe',
  CZ: 'europe', DK: 'europe', EE: 'europe', FI: 'europe', FR: 'europe', DE: 'europe', GR: 'europe', HU: 'europe', IS: 'europe',
  IE: 'europe', IT: 'europe', XK: 'europe', LV: 'europe', LI: 'europe', LT: 'europe', LU: 'europe', MT: 'europe', MD: 'europe',
  MC: 'europe', ME: 'europe', NL: 'europe', MK: 'europe', NO: 'europe', PL: 'europe', PT: 'europe', RO: 'europe', RU: 'europe',
  SM: 'europe', RS: 'europe', SK: 'europe', SI: 'europe', ES: 'europe', SE: 'europe', CH: 'europe', UA: 'europe', GB: 'europe',
  // Asia
  AM: 'asia', AZ: 'asia', BD: 'asia', CN: 'asia', GE: 'asia', HK: 'asia', IN: 'asia', ID: 'asia', IR: 'asia', IQ: 'asia',
  IL: 'asia', JP: 'asia', JO: 'asia', KZ: 'asia', KR: 'asia', KW: 'asia', LB: 'asia', MY: 'asia', MN: 'asia', NP: 'asia',
  PK: 'asia', PH: 'asia', QA: 'asia', SA: 'asia', SG: 'asia', LK: 'asia', TW: 'asia', TH: 'asia', TR: 'asia', AE: 'asia',
  UZ: 'asia', VN: 'asia',
  // Africa
  DZ: 'africa', EG: 'africa', ET: 'africa', GH: 'africa', KE: 'africa', MA: 'africa', NG: 'africa', SN: 'africa', ZA: 'africa',
  TN: 'africa', UG: 'africa', TZ: 'africa',
  // North America
  CA: 'north-america', CR: 'north-america', CU: 'north-america', DO: 'north-america', GT: 'north-america', MX: 'north-america',
  PA: 'north-america', PR: 'north-america', US: 'north-america',
  // South America
  AR: 'south-america', BO: 'south-america', BR: 'south-america', CL: 'south-america', CO: 'south-america', EC: 'south-america',
  PY: 'south-america', PE: 'south-america', UY: 'south-america', VE: 'south-america',
  // Oceania
  AU: 'oceania', FJ: 'oceania', NZ: 'oceania',
};

export const continentOf = (country: string | null | undefined): Continent | null => (country ? (COUNTRIES[country.toUpperCase()] ?? null) : null);
