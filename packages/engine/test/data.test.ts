import { describe, it, expect } from 'vitest';
import { CARDS, PATRONS } from '../src/data/cards';
import { ACADEMIES } from '../src/data/academies';
import type { CardDef, Family, Term } from '../src/types';

const copies = (cards: readonly CardDef[], term: Term, n: number, fam?: Family) =>
  cards
    .filter((c) => c.term === term && (!fam || c.family === fam))
    .reduce((sum, c) => sum + c.minPlayers.filter((m) => m <= n).length, 0);

describe('card data', () => {
  it('term totals', () => {
    for (let n = 3; n <= 7; n++) {
      expect(copies(CARDS, 1, n)).toBe(7 * n);
      expect(copies(CARDS, 2, n)).toBe(7 * n);
      expect(copies(CARDS, 3, n)).toBe(6 * n - 2);
    }
  });

  it('family counts at 7 players', () => {
    const expected: Record<Term, Partial<Record<Family, number>>> = {
      1: { basic: 13, rare: 7, lore: 8, trade: 8, duel: 6, research: 7 },
      2: { basic: 8, rare: 7, lore: 8, trade: 9, duel: 9, research: 8 },
      3: { lore: 10, trade: 10, duel: 10, research: 10 },
    };
    for (const term of [1, 2, 3] as Term[]) {
      for (const [fam, count] of Object.entries(expected[term])) {
        expect(copies(CARDS, term, 7, fam as Family), `term ${term} ${fam}`).toBe(count);
      }
    }
  });

  it('term 2 basic cards produce 2', () => {
    for (const c of CARDS.filter((c) => c.term === 2 && c.family === 'basic')) {
      const p = c.effects.find((e) => e.kind === 'produce');
      expect(p && p.kind === 'produce' && p.amount).toBe(2);
    }
  });

  it('unique ids and names', () => {
    const all = [...CARDS, ...PATRONS];
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
  });

  it('chains resolve to earlier terms and there are enough of them', () => {
    const byName = new Map(CARDS.map((c) => [c.name, c]));
    let t12 = 0;
    let t23 = 0;
    for (const c of CARDS) {
      for (const from of c.chainFrom ?? []) {
        const src = byName.get(from);
        expect(src, `${c.name} chains from missing ${from}`).toBeDefined();
        expect(src!.term).toBeLessThan(c.term);
        if (c.term === 2) t12++;
        if (c.term === 3) t23++;
      }
    }
    expect(t12).toBeGreaterThanOrEqual(8);
    expect(t23).toBeGreaterThanOrEqual(6);
  });

  it('no basic or rare in term 3', () => {
    expect(CARDS.filter((c) => c.term === 3 && (c.family === 'basic' || c.family === 'rare'))).toEqual([]);
  });

  it('research disciplines have at least 2 copies per term', () => {
    for (const term of [1, 2, 3] as Term[]) {
      for (const d of ['alchemy', 'astronomy', 'runes']) {
        const n = CARDS.filter(
          (c) => c.term === term && c.effects.some((e) => e.kind === 'research' && e.discipline === d),
        ).reduce((s, c) => s + c.minPlayers.length, 0);
        expect(n, `term ${term} ${d}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('patrons: 10 term-3 patron cards', () => {
    expect(PATRONS).toHaveLength(10);
    for (const p of PATRONS) {
      expect(p.family).toBe('patron');
      expect(p.term).toBe(3);
    }
  });

  it('forbidden names', () => {
    const banned = ['lumber', 'quarry', 'glass', 'loom', 'press', 'guild', 'wonder', 'pantheon', 'aqueduct',
      'scriptorium', 'apothecary', 'stockade', 'barracks', 'caravansery', 'forum', 'bazar', 'lighthouse', 'arena'];
    for (const c of [...CARDS, ...PATRONS]) {
      for (const b of banned) expect(c.name.toLowerCase(), c.name).not.toContain(b);
    }
  });
});

describe('academies', () => {
  it('seven academies with the spec homes and powers', () => {
    const homes = Object.fromEntries(ACADEMIES.map((a) => [a.id, a.home]));
    expect(homes).toEqual({
      pyromancy: 'ore', hydromancy: 'moonstone', verdant: 'herbs', shadow: 'ink',
      astral: 'starglass', chronomancy: 'essence', runeforge: 'dragonscale',
    });
    const powers: Record<string, string> = {
      pyromancy: 'pyroDuelBonus', hydromancy: 'hydroTradeBonus', verdant: 'verdantWhiteRenown',
      shadow: 'shadowTax', astral: 'astralSetBonus', chronomancy: 'chronoKeep', runeforge: 'runeChainCoins',
    };
    for (const a of ACADEMIES) {
      expect(a.sides.A).toHaveLength(3);
      expect(a.sides.A[1].power).toBe(powers[a.id]);
      expect(a.sides.B.length).toBeGreaterThanOrEqual(2);
      expect(a.sides.B.some((s) => s.power === powers[a.id])).toBe(true);
    }
  });

  it('no first tower level costs the academy home resource', () => {
    for (const a of ACADEMIES)
      for (const side of [a.sides.A, a.sides.B]) expect(side[0].cost.resources?.[a.home], `${a.id}`).toBeUndefined();
  });
});
