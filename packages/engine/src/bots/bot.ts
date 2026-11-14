import type { Action, BotLevel, Discipline, GameState } from '../types';
import { legalActions, submitAction, actingSeats, scopeCount } from '../actions';
import { cardDef } from '../data/cards';
import { academyDef } from '../data/academies';
import { nextRandom } from '../rng';
import { scoreResearch } from '../scoring';
import { archmagePick } from './archmage';
import { hardPick } from './hard';

const paid = (a: Action) => ('payment' in a ? a.payment.coinsToBank + a.payment.coinsToLeft + a.payment.coinsToRight : 0);

function researchCounts(s: GameState, seat: number): Record<Discipline, number> {
  const counts: Record<Discipline, number> = { alchemy: 0, astronomy: 0, runes: 0 };
  for (const c of s.players[seat].built) for (const e of cardDef(c.defId).effects) if (e.kind === 'research') counts[e.discipline]++;
  return counts;
}

/** Rough immediate value of building a card, in Renown-equivalents. */
export function cardValue(s: GameState, seat: number, defId: string): number {
  const def = cardDef(defId);
  const futureTurns = (3 - s.term) * 6 + (6 - s.turn);
  let v = 0;
  for (const e of def.effects) {
    if (e.kind === 'renown') v += e.amount;
    if (e.kind === 'renownPer') v += e.per * scopeCount(s, seat, e.what, e.scope) + e.per;
    if (e.kind === 'duel') v += 1.5 * e.amount * (s.term === 3 ? 1.5 : 1);
    if (e.kind === 'coins') v += e.amount / 3;
    if (e.kind === 'coinsPer') v += (e.per * scopeCount(s, seat, e.what, e.scope)) / 3;
    if (e.kind === 'produce') v += 0.5 * e.amount * Math.min(3, futureTurns / 6);
    if (e.kind === 'tradeDiscount') v += s.term === 1 ? 1.5 : 0.5;
    if (e.kind === 'research') {
      const before = researchCounts(s, seat);
      const after = { ...before, [e.discipline]: before[e.discipline] + 1 };
      v += scoreResearch(after, false) - scoreResearch(before, false);
    }
  }
  return v;
}

/** Normal bot: greedy immediate value, with a little denial and a nudge towards academy stages. */
function actionValue(s: GameState, seat: number, a: Action): number {
  const p = s.players[seat];
  const card = [...p.hand, ...(s.kept[seat] ? [s.kept[seat]!] : [])].find((c) => c.uid === a.cardUid)!;
  const cost = paid(a) / 3;
  if (a.type === 'sell') return 1;
  if (a.type === 'chronoKeep') return 0.5 + 0.5 * cardValue(s, seat, card.defId);
  if (a.type === 'tower') {
    const st = academyDef(p.academyId).sides[p.side][p.towerStages];
    const renown = st.effects.reduce((sum, e) => sum + (e.kind === 'renown' ? e.amount : 0), 0);
    return renown + (st.power ? 4 : 0) - cost + 1;
  }
  let v = cardValue(s, seat, card.defId) - cost;
  v += 0.4 * cardValue(s, seat, card.defId); // denial: strong cards are worth taking away
  return v;
}

/**
 * Deterministic bot pick for a seat at the given level.
 * easy: weighted random; normal: greedy value with light denial; hard: see ./hard.ts.
 */
export function botPick(s: GameState, seat: number, level: BotLevel): Action {
  const acts = legalActions(s, seat);
  if (level === 'easy') {
    const weights = acts.map((a) => (a.type === 'build' ? 3 : 1));
    const total = weights.reduce((x, y) => x + y, 0);
    const [r] = nextRandom((s.rngState ^ (seat * 7919 + s.turn * 104729 + s.term * 31)) | 0);
    let t = r * total;
    for (let i = 0; i < acts.length; i++) {
      t -= weights[i];
      if (t < 0) return acts[i];
    }
    return acts[acts.length - 1];
  }
  if (level === 'hard') return hardPick(s, seat);
  let best = acts[0];
  let bestV = -Infinity;
  for (const a of acts) {
    const v = actionValue(s, seat, a);
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best;
}

/** Submit a pick for every acting non-human seat that has not submitted yet. */
export function autoPlay(s: GameState): GameState {
  let next = s;
  for (const seat of actingSeats(s)) {
    const p = next.players[seat];
    if (p.pending || p.config.kind === 'human') continue;
    const a = p.config.kind === 'archmage' ? archmagePick(next, seat) : botPick(next, seat, p.config.botLevel ?? 'normal');
    next = submitAction(next, seat, a);
  }
  return next;
}
