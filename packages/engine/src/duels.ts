import type { GameState, Term } from './types';
import { effectsOf, leftOf, rightOf } from './payment';
import { hasPower } from './powers';

const WIN: Record<Term, number> = { 1: 1, 2: 3, 3: 5 };

/** Total duel power of a seat (cumulative over all built cards and tower stages). */
export function duelPower(s: GameState, seat: number): number {
  return effectsOf(s, seat).reduce((sum, e) => sum + (e.kind === 'duel' ? e.amount : 0), 0);
}

/** End-of-term duels: each seat compares with each neighbor; win +1/+3/+5 (+1 Pyromancy), loss -1, tie 0. */
export function resolveDuels(s: GameState, term: Term): GameState {
  const power = s.players.map((p) => duelPower(s, p.seat));
  const tokens = s.duelTokens.map((t) => [...t]);
  for (const p of s.players) {
    const neighbors = [...new Set([leftOf(s, p.seat), rightOf(s, p.seat)])];
    for (const n of neighbors) {
      if (power[p.seat] > power[n]) tokens[p.seat].push(WIN[term] + (hasPower(s, p.seat, 'pyroDuelBonus') ? 1 : 0));
      else if (power[p.seat] < power[n]) tokens[p.seat].push(-1);
    }
  }
  return { ...s, duelTokens: tokens };
}
