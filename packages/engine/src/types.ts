export type BasicResource = 'herbs' | 'ore' | 'ink' | 'moonstone';
export type RareResource = 'essence' | 'starglass' | 'dragonscale';
export type Resource = BasicResource | RareResource;

export const BASIC_RESOURCES: readonly BasicResource[] = ['herbs', 'ore', 'ink', 'moonstone'];
export const RARE_RESOURCES: readonly RareResource[] = ['essence', 'starglass', 'dragonscale'];
export const RESOURCES: readonly Resource[] = [...BASIC_RESOURCES, ...RARE_RESOURCES];

/** Card families. Display colors: basic=white, rare=black, lore=gold, trade=turquoise, duel=orange, research=magenta, patron=silver. */
export type Family = 'basic' | 'rare' | 'lore' | 'trade' | 'duel' | 'research' | 'patron';
export type Discipline = 'alchemy' | 'astronomy' | 'runes';
export const DISCIPLINES: readonly Discipline[] = ['alchemy', 'astronomy', 'runes'];
export type Term = 1 | 2 | 3;
export type Side = 'left' | 'right';

export type Cost = { coins?: number; resources?: Partial<Record<Resource, number>> };
export type CountTarget = Family | 'towerStage';

export type Effect =
  | { kind: 'produce'; options: Resource[]; amount: number }
  | { kind: 'renown'; amount: number }
  | { kind: 'duel'; amount: number }
  | { kind: 'research'; discipline: Discipline }
  | { kind: 'coins'; amount: number }
  | { kind: 'tradeDiscount'; group: 'basic' | 'rare'; sides: Side[] }
  | { kind: 'coinsPer'; what: CountTarget; per: number; scope: 'self' | 'selfAndNeighbors' }
  | { kind: 'renownPer'; what: CountTarget; per: number; scope: 'self' | 'neighbors' | 'selfAndNeighbors' }
  /** One research symbol of your choice, picked at final scoring for the most points. */
  | { kind: 'researchAny' }
  /** When this tower level is built: build one card from the discard pile, free. */
  | { kind: 'buildDiscard' };

export interface CardDef {
  id: string;
  name: string;
  term: Term;
  family: Family;
  cost: Cost;
  effects: Effect[];
  /** Names of cards that let this one be built for free. */
  chainFrom?: string[];
  /** One entry per physical copy: the minimum number of seats at which that copy is used. */
  minPlayers: number[];
}

export interface Card {
  uid: string;
  defId: string;
}

/** Lasting academy abilities, active once the tower level that carries them is built. */
export type PowerId =
  /** Play the last card of each Term instead of discarding it. */
  | 'playLastCard'
  /** Build free the first card of each family you don't own yet. */
  | 'freeNewFamily'
  /** Build free the card you play on turn 1 of each Term. */
  | 'freeFirstTurn'
  /** Build free the card you play on turn 6 of each Term. */
  | 'freeSixthTurn';

export interface TowerStage {
  cost: Cost;
  effects: Effect[];
  power?: PowerId;
}

export interface AcademyDef {
  id: string;
  name: string;
  home: Resource;
  sides: Record<'A' | 'B', TowerStage[]>;
}

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface SeatConfig {
  kind: 'human' | 'bot' | 'archmage';
  name: string;
  academyId?: string;
  side?: 'A' | 'B';
  botLevel?: BotLevel;
}

export interface PaymentPlan {
  buyLeft: Partial<Record<Resource, number>>;
  buyRight: Partial<Record<Resource, number>>;
  coinsToLeft: number;
  coinsToRight: number;
  coinsToBank: number;
  free: boolean;
}

export type Action =
  | { type: 'build'; cardUid: string; payment: PaymentPlan }
  | { type: 'tower'; cardUid: string; payment: PaymentPlan }
  | { type: 'sell'; cardUid: string };

export interface PlayerState {
  seat: number;
  config: SeatConfig;
  academyId: string;
  side: 'A' | 'B';
  coins: number;
  built: Card[];
  /** Cards tucked under the tower (hidden). */
  towerCards: Card[];
  towerStages: number;
  hand: Card[];
  pending?: Action;
  flags: Record<string, number>;
}

export type LogEntry = { term: Term; turn: number; seat: number; text: string };

export interface GameState {
  seed: number;
  rngState: number;
  term: Term;
  turn: number;
  /**
   * 'bonus' = after turn 6, seats with playLastCard play their last card;
   * 'discard' = seats with discardPicks build one card from the discard pile, free.
   */
  phase: 'picking' | 'bonus' | 'discard' | 'ended';
  /** Free builds from the discard pile still owed per seat (discard phase). */
  discardPicks?: number[];
  /** Where play continues after the discard phase. */
  resume?: 'advance' | 'endTerm';
  players: PlayerState[];
  archive: Card[];
  log: LogEntry[];
  /** duelTokens[seat] = list of Renown deltas from duels. */
  duelTokens: number[][];
  /** Last card of the Term held by a seat with playLastCard, played in the bonus phase. */
  kept: (Card | null)[];
}
