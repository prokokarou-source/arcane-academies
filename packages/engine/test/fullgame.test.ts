import { describe, it, expect } from 'vitest';
import { createGame, autoPlay, resolveTurn, winners, submitAction } from '../src/index';
import type { Action, GameState } from '../src/index';
import { seats } from './helpers';

function playOut(seed: number, n: number) {
  let s = createGame({ seed, seats: seats(n) });
  const actions: { seat: number; action: Action }[][] = [];
  let turns = 0;
  while (s.phase !== 'ended' && turns < 30) {
    s = autoPlay(s);
    actions.push(s.players.filter((p) => p.pending).map((p) => ({ seat: p.seat, action: p.pending! })));
    s = resolveTurn(s);
    turns++;
  }
  return { s, actions, turns };
}

describe('full game', () => {
  it('bot-only games always end', () => {
    for (const n of [2, 3, 5, 7]) {
      for (let seed = 1; seed <= 20; seed++) {
        const { s, turns } = playOut(seed, n);
        expect(s.phase, `n=${n} seed=${seed}`).toBe('ended');
        expect(turns).toBeLessThanOrEqual(19);
        expect(winners(s).length).toBeGreaterThan(0);
      }
    }
  });

  it('card conservation', () => {
    const { s } = playOut(5, 4);
    const dealt = 3 * 7 * s.players.length;
    const places = [
      ...s.archive.map((c) => c.uid),
      ...s.players.flatMap((p) => [...p.built, ...p.towerCards].map((c) => c.uid)),
      ...s.kept.filter((k): k is NonNullable<typeof k> => !!k).map((k) => k.uid),
    ];
    expect(places).toHaveLength(dealt);
    expect(new Set(places).size).toBe(dealt);
  });

  it('replay determinism', () => {
    const { s, actions } = playOut(9, 5);
    let r: GameState = createGame({ seed: 9, seats: seats(5) });
    for (const turn of actions) {
      for (const { seat, action } of turn) r = submitAction(r, seat, action);
      r = resolveTurn(r);
    }
    expect(r).toEqual(s);
  });
});
