import type { Action, GameState } from '../types';
import { legalActions } from '../actions';
import { cardDef } from '../data/cards';
import { duelPower } from '../duels';
import { leftOf, rightOf } from '../payment';

const costUnits = (defId: string) => {
  const c = cardDef(defId).cost;
  return Object.values(c.resources ?? {}).reduce((a, b) => a + (b ?? 0), 0) + (c.coins ?? 0);
};
const defOf = (s: GameState, seat: number, uid: string) => {
  const p = s.players[seat];
  const card = [...p.hand, ...(s.kept[seat] ? [s.kept[seat]!] : [])].find((c) => c.uid === uid)!;
  return card.defId;
};

/** Rival Archmage: duel card when behind a neighbor, else most expensive affordable card, else sell. */
export function archmagePick(s: GameState, seat: number): Action {
  const acts = legalActions(s, seat);
  const builds = acts
    .filter((a) => a.type === 'build')
    .sort((a, b) => (a.cardUid < b.cardUid ? -1 : a.cardUid > b.cardUid ? 1 : 0));
  const mine = duelPower(s, seat);
  const behind = [leftOf(s, seat), rightOf(s, seat)].some((n) => n !== seat && duelPower(s, n) > mine);
  if (behind) {
    const duel = builds.find((a) => cardDef(defOf(s, seat, a.cardUid)).family === 'duel');
    if (duel) return duel;
  }
  if (builds.length) {
    let best = builds[0];
    for (const a of builds) if (costUnits(defOf(s, seat, a.cardUid)) > costUnits(defOf(s, seat, best.cardUid))) best = a;
    return best;
  }
  return acts.find((a) => a.type === 'sell')!;
}
