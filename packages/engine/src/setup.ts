import type { Card, GameState, PlayerState, SeatConfig, Term } from './types';
import { CARDS, PATRONS } from './data/cards';
import { ACADEMIES } from './data/academies';
import { shuffle } from './rng';

const ARCHMAGE: SeatConfig = { kind: 'archmage', name: 'Rival Archmage' };

/** Create a new game. 2–7 seats; with 2 seats a Rival Archmage is inserted at index 1. Term 1 is dealt. */
export function createGame(opts: { seed: number; seats: SeatConfig[] }): GameState {
  const { seed } = opts;
  if (opts.seats.length < 2 || opts.seats.length > 7) {
    throw new Error(`A game needs 2–7 seats, got ${opts.seats.length}`);
  }
  const configs = opts.seats.length === 2 ? [opts.seats[0], ARCHMAGE, opts.seats[1]] : [...opts.seats];

  const chosen = new Set(configs.map((c) => c.academyId).filter((x): x is string => !!x));
  let rng = seed | 0;
  const [freeAcademies, rng1] = shuffle(ACADEMIES.map((a) => a.id).filter((id) => !chosen.has(id)), rng);
  rng = rng1;
  let next = 0;

  const players: PlayerState[] = configs.map((config, seat) => ({
    seat,
    config,
    academyId: config.academyId ?? freeAcademies[next++],
    side: config.side ?? 'A',
    coins: 3,
    built: [],
    towerCards: [],
    towerStages: 0,
    hand: [],
    flags: {},
  }));

  const state: GameState = {
    seed,
    rngState: rng,
    term: 1,
    turn: 1,
    phase: 'picking',
    players,
    archive: [],
    log: [],
    duelTokens: players.map(() => []),
    kept: players.map(() => null),
  };
  return dealTerm(state, 1);
}

/** Deal 7 cards to every seat for the given term (Term 3 adds seats + 2 random patrons). */
export function dealTerm(state: GameState, term: Term): GameState {
  const n = state.players.length;
  const copies: Card[] = [];
  for (const def of CARDS) {
    if (def.term !== term) continue;
    def.minPlayers.forEach((min, i) => {
      if (min <= n) copies.push({ uid: `${def.id}#${i}`, defId: def.id });
    });
  }
  let rng = state.rngState;
  if (term === 3) {
    const [patrons, r] = shuffle(PATRONS, rng);
    rng = r;
    for (const p of patrons.slice(0, n + 2)) copies.push({ uid: `${p.id}#0`, defId: p.id });
  }
  const [deck, r2] = shuffle(copies, rng);
  if (deck.length !== 7 * n) throw new Error(`Term ${term} deck has ${deck.length} cards, expected ${7 * n}`);
  return {
    ...state,
    rngState: r2,
    term,
    turn: 1,
    players: state.players.map((p, i) => ({ ...p, hand: deck.slice(i * 7, i * 7 + 7), pending: undefined })),
  };
}
