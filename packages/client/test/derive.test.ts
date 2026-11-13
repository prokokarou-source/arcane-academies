import { describe, expect, it } from 'vitest';
import { legalActions, viewFor } from '@arcane/engine';
import { towerStagesOf, duelPowerOf, handOptions, neighbors, productionOf, termDuels, tradeCost, waitingFor } from '../src/game/derive';
import { makeGame, seatsOf } from './views';

describe('derive', () => {
  const s = makeGame(['Ana', 'Bob', 'Cleo']);
  const view = viewFor(s, 0);
  const legal = legalActions(s, 0);

  it('gives one entry per hand card with the legal actions themselves', () => {
    const opts = handOptions(view, legal);
    expect(opts).toHaveLength(7);
    expect(opts.map((o) => o.cardUid)).toEqual(view.players[0].hand!.map((c) => c.uid));
    for (const o of opts) {
      expect(o.sell).toBeDefined();
      if (o.build) expect(legal.includes(o.build)).toBe(true);
    }
  });

  it('shows only the kept card in the bonus phase', () => {
    const kept = view.players[0].hand![0];
    const v = { ...view, phase: 'bonus' as const, players: view.players.map((p, i) => (i === 0 ? { ...p, kept } : p)) };
    const opts = handOptions(v, [{ type: 'sell', cardUid: kept.uid }]);
    expect(opts.map((o) => o.cardUid)).toEqual([kept.uid]);
  });

  it('finds neighbors like the engine', () => {
    expect(neighbors(view)).toEqual({ left: 2, right: 1 });
    expect(neighbors(viewFor(s, 2))).toEqual({ left: 1, right: 0 });
  });

  it('reads duel power and production from a player', () => {
    expect(duelPowerOf(view.players[0])).toBe(0);
    expect(productionOf(view.players[0])).toEqual([{ options: ['ore'], amount: 1 }]);
  });

  it('lists every tower level with its cost, reward and whether it is built', () => {
    const stages = towerStagesOf({ ...view.players[0], towerStages: 1 });
    expect(stages).toHaveLength(3);
    expect(stages.map((x) => x.built)).toEqual([true, false, false]);
    expect(stages[0].cost).toEqual({ resources: { ore: 2 } });
    expect(stages[1].power).toBe('pyroDuelBonus');
    expect(stages[2].effects).toEqual([{ kind: 'renown', amount: 7 }]);
  });

  it('sums the trade cost of both sides', () => {
    expect(tradeCost({ buyLeft: {}, buyRight: {}, coinsToLeft: 2, coinsToRight: 1, coinsToBank: 4, free: false })).toBe(3);
  });

  it('reports the duel tokens added between two views', () => {
    expect(termDuels(view, view)).toBeNull();
    expect(termDuels(null, view)).toBeNull();
    const next = { ...view, duelTokens: [[1], [], [-1]] };
    expect(termDuels(view, next)).toEqual([
      { seat: 0, deltas: [1] },
      { seat: 1, deltas: [] },
      { seat: 2, deltas: [-1] },
    ]);
  });

  it('reports a Term end even when every duel was a tie', () => {
    const next = { ...view, term: 2 as const };
    expect(termDuels(view, next)).toEqual([
      { seat: 0, deltas: [] },
      { seat: 1, deltas: [] },
      { seat: 2, deltas: [] },
    ]);
    expect(termDuels({ ...view, term: 3 }, { ...view, term: 3, phase: 'ended' })).not.toBeNull();
  });

  it('lists who has not submitted, without the Archmage, and nobody in the bonus phase', () => {
    const seats = seatsOf(s);
    expect(waitingFor(view, seats)).toEqual(['Ana', 'Bob', 'Cleo']);
    const v = { ...view, players: view.players.map((p, i) => ({ ...p, hasSubmitted: i === 1 })) };
    expect(waitingFor(v, seats)).toEqual(['Ana', 'Cleo']);
    expect(waitingFor(v, seats.map((x, i) => (i === 2 ? { ...x, kind: 'archmage' as const } : x)))).toEqual(['Ana']);
    expect(waitingFor({ ...view, phase: 'bonus' }, seats)).toBeNull();
  });
});
