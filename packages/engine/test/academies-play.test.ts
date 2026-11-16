import { describe, expect, it } from 'vitest';
import { ACADEMIES } from '../src/data/academies';
import { autoPlay, createGame, finalScores, resolveTurn } from '../src/index';
import type { SeatConfig } from '../src/types';

describe('new academies in full games', () => {
  for (const side of ['A', 'B'] as const) {
    it(`7 bots, every academy on side ${side}, several seeds: games end and scores add up`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const seats: SeatConfig[] = ACADEMIES.map((a, i) => ({ kind: 'bot', name: `P${i}`, botLevel: i % 2 ? 'hard' : 'normal', academyId: a.id, side }));
        let s = createGame({ seed, seats });
        for (let n = 0; s.phase !== 'ended' && n < 80; n++) s = resolveTurn(autoPlay(s));
        expect(s.phase).toBe('ended');
        for (const b of finalScores(s)) expect(b.items.reduce((x, i) => x + i.points, 0)).toBe(b.total);
      }
    });
  }
});
