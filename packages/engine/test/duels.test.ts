import { describe, it, expect } from 'vitest';
import { resolveDuels, duelPower } from '../src/duels';
import { fixedGame, withBuilt, withTower } from './helpers';

describe('duels', () => {
  it('win +1/+3/+5, loss -1, tie 0 against each neighbor', () => {
    const base = withBuilt(fixedGame(), 0, ['t1-practice-yard']); // seat0: 1, others 0
    expect(resolveDuels(base, 1).duelTokens).toEqual([[1, 1], [-1], [-1]]);
    expect(resolveDuels(base, 2).duelTokens[0]).toEqual([3, 3]);
    expect(resolveDuels(base, 3).duelTokens[0]).toEqual([5, 5]);
    const tie = withBuilt(base, 1, ['t1-ward-circle']);
    expect(resolveDuels(tie, 1).duelTokens[1]).toEqual([1]); // ties seat0, beats seat2
  });

  it('duel power is cumulative across terms', () => {
    const s = withBuilt(fixedGame(), 0, ['t1-practice-yard', 't2-dueling-grounds']);
    expect(duelPower(s, 0)).toBe(3);
  });

  it('pyroDuelBonus adds +1 per win', () => {
    let s = withBuilt(fixedGame(), 0, ['t1-practice-yard']); // seat0 is pyromancy
    s = withTower(s, 0, 2);
    expect(resolveDuels(s, 1).duelTokens[0]).toEqual([2, 2]);
  });
});
