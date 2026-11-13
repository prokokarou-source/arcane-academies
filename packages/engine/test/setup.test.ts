import { describe, it, expect } from 'vitest';
import { createGame, dealTerm } from '../src/setup';
import { cardDef } from '../src/data/cards';
import { seats } from './helpers';




describe('setup', () => {
  it('deals 7 cards per seat in every term', () => {
    for (const n of [2, 3, 7]) {
      let s = createGame({ seed: 7, seats: seats(n) });
      for (const term of [1, 2, 3] as const) {
        s = dealTerm(s, term);
        for (const p of s.players) expect(p.hand).toHaveLength(7);
        const all = s.players.flatMap((p) => p.hand.map((c) => c.uid));
        expect(new Set(all).size).toBe(all.length);
      }
    }
  });

  it('two players get an archmage at seat 1', () => {
    const s = createGame({ seed: 1, seats: seats(2) });
    expect(s.players).toHaveLength(3);
    expect(s.players[1].config.kind).toBe('archmage');
  });

  it('start state', () => {
    const s = createGame({ seed: 3, seats: seats(5) });
    expect(s.term).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('picking');
    for (const p of s.players) expect(p.coins).toBe(3);
    expect(new Set(s.players.map((p) => p.academyId)).size).toBe(5);
  });

  it('respects a chosen academy', () => {
    const cfg = seats(3);
    cfg[2] = { ...cfg[2], academyId: 'runeforge', side: 'B' };
    const s = createGame({ seed: 3, seats: cfg });
    expect(s.players[2].academyId).toBe('runeforge');
    expect(s.players[2].side).toBe('B');
  });

  it('deterministic', () => {
    expect(createGame({ seed: 99, seats: seats(4) })).toEqual(createGame({ seed: 99, seats: seats(4) }));
  });

  it('term 3 includes n+2 patrons', () => {
    for (const n of [2, 4, 7]) {
      const s = dealTerm(createGame({ seed: 5, seats: seats(n) }), 3);
      const seatsCount = s.players.length;
      const patrons = s.players.flatMap((p) => p.hand).filter((c) => cardDef(c.defId).family === 'patron');
      expect(patrons).toHaveLength(seatsCount + 2);
    }
  });

  it('rejects 1 or 8 seats', () => {
    expect(() => createGame({ seed: 1, seats: seats(1) })).toThrow(Error);
    expect(() => createGame({ seed: 1, seats: seats(8) })).toThrow(Error);
  });
});
