import { describe, expect, it } from 'vitest';
import { expected, ratingDeltas, streaks } from '../src/rating';

describe('rating math', () => {
  it('1v1 between equals moves 16 points each way; a draw moves nothing', () => {
    const d = ratingDeltas([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1000, place: 2 },
    ]);
    expect([d.get('a'), d.get('b')]).toEqual([16, -16]);
    const draw = ratingDeltas([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1000, place: 1 },
    ]);
    expect([draw.get('a'), draw.get('b')]).toEqual([0, 0]);
  });

  it('1v1 follows Elo with K = 32 against the opponent rating', () => {
    expect(expected(1200, 1000)).toBeCloseTo(0.7597, 4);
    const upset = ratingDeltas([
      { id: 'low', rating: 1000, place: 1 },
      { id: 'high', rating: 1200, place: 2 },
    ]);
    expect(upset.get('low')).toBe(24);
    expect(upset.get('high')).toBe(-24);
    const fav = ratingDeltas([
      { id: 'low', rating: 1000, place: 2 },
      { id: 'high', rating: 1200, place: 1 },
    ]);
    expect(fav.get('high')).toBe(8);
  });

  it('multiplayer is pairwise by place with K split over the n - 1 opponents', () => {
    // 4 equals: first beats 3 → 32/3 * 1.5 = 16; second 32/3 * 0.5 ≈ 5; third −5; last −16.
    const d = ratingDeltas(['a', 'b', 'c', 'd'].map((id, i) => ({ id, rating: 1000, place: i + 1 })));
    expect(['a', 'b', 'c', 'd'].map((id) => d.get(id))).toEqual([16, 5, -5, -16]);
    // Shared first place: the two winners draw each other.
    const tie = ratingDeltas([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1000, place: 1 },
      { id: 'c', rating: 1000, place: 3 },
    ]);
    expect([tie.get('a'), tie.get('b'), tie.get('c')]).toEqual([8, 8, -16]);
  });

  it('changes nothing for a lone player', () => {
    expect(ratingDeltas([{ id: 'a', rating: 1000, place: 1 }]).size).toBe(0);
  });

  it('counts the current and longest win streaks', () => {
    expect(streaks([])).toEqual({ streak: 0, bestStreak: 0 });
    expect(streaks([true, true, true, false, true])).toEqual({ streak: 1, bestStreak: 3 });
    expect(streaks([false, true, true])).toEqual({ streak: 2, bestStreak: 2 });
  });
});
