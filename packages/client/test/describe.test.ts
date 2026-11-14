import { describe, expect, it } from 'vitest';
import { cardDef, CARDS, PATRONS } from '@arcane/engine';
import { translate } from '../src/i18n/strings';
import { describeCard } from '../src/game/describe';

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
const id = (name: string) => [...CARDS, ...PATRONS].find((c) => c.name === name)!.id;

describe('describeCard', () => {
  it('explains a trade discount, a free cost and what it unlocks', () => {
    const d = describeCard(id('Eastwind Courier'), t);
    expect(d.family).toBe('Trade (yellow)');
    expect(d.cost).toBe('Free to build.');
    expect(d.effects).toEqual(['Buy basic resources (Herbs, Ore, Ink, Moonstone) from your right neighbor for 1 coin each instead of 2.']);
    expect(d.unlocks).toBe('Later you can build for free: Grand Exchange.');
  });

  it('explains a choice of resources and a chain prerequisite', () => {
    const d = describeCard(id('Grand Exchange'), t);
    expect(d.cost).toBe('Cost: 2 Herbs.');
    expect(d.effects).toEqual(['Produces 1 of Herbs, Ore, Ink or Moonstone each turn (your choice).']);
    expect(d.chainFrom).toBe('Free if you already own Westwind Courier or Eastwind Courier.');
  });

  it('describes every card and patron without placeholders left over', () => {
    for (const c of [...CARDS, ...PATRONS]) {
      const d = describeCard(c.id, t);
      expect(d.effects.length).toBe(cardDef(c.id).effects.length);
      for (const line of [d.cost, ...d.effects]) expect(line).not.toMatch(/\{\w+\}/);
    }
  });
});
