import type { Cost, Effect, GameState, PaymentPlan, Resource, Side } from './types';
import { RARE_RESOURCES } from './types';
import { cardDef } from './data/cards';
import { academyDef } from './data/academies';

type Produce = Extract<Effect, { kind: 'produce' }>;

export const leftOf = (s: GameState, seat: number) => (seat + s.players.length - 1) % s.players.length;
export const rightOf = (s: GameState, seat: number) => (seat + 1) % s.players.length;

/** All effects a seat currently has: built cards plus built tower stages. */
export function effectsOf(s: GameState, seat: number): Effect[] {
  const p = s.players[seat];
  const fromCards = p.built.flatMap((c) => cardDef(c.defId).effects);
  const stages = academyDef(p.academyId).sides[p.side].slice(0, p.towerStages);
  return [...fromCards, ...stages.flatMap((st) => st.effects)];
}

/**
 * Production of a seat. forTrade=true: only what neighbors may buy (home resource + basic/rare cards).
 * forTrade=false: everything the seat itself can use (adds trade cards and tower stages).
 */
export function productionOf(s: GameState, seat: number, forTrade: boolean): Produce[] {
  const p = s.players[seat];
  const home: Produce = { kind: 'produce', options: [academyDef(p.academyId).home], amount: 1 };
  const cards = p.built.flatMap((c) => {
    const d = cardDef(c.defId);
    if (forTrade && d.family !== 'basic' && d.family !== 'rare') return [];
    return d.effects.filter((e): e is Produce => e.kind === 'produce');
  });
  const stages = forTrade
    ? []
    : academyDef(p.academyId).sides[p.side].slice(0, p.towerStages).flatMap((st) => st.effects.filter((e): e is Produce => e.kind === 'produce'));
  return [home, ...cards, ...stages];
}

/** Price (1 or 2) the seat pays to buy one unit of a resource from the neighbor on the given side. */
export function tradePrice(s: GameState, seat: number, side: Side, resource: Resource): 1 | 2 {
  const group = (RARE_RESOURCES as readonly string[]).includes(resource) ? 'rare' : 'basic';
  const discounted = effectsOf(s, seat).some((e) => e.kind === 'tradeDiscount' && e.group === group && e.sides.includes(side));
  return discounted ? 1 : 2;
}

type Slot = { options: Resource[]; remaining: number; chosen?: Resource; owner: 'self' | Side };

/**
 * Cheapest way for a seat to pay a cost, or null if impossible.
 * chainFrom: names of cards that make this build free when the seat owns one of them.
 */
export function planPayment(s: GameState, seat: number, cost: Cost, chainFrom?: string[]): PaymentPlan | null {
  const p = s.players[seat];
  const empty: PaymentPlan = { buyLeft: {}, buyRight: {}, coinsToLeft: 0, coinsToRight: 0, coinsToBank: 0, free: false };
  if (chainFrom?.length) {
    const owned = new Set(p.built.map((c) => cardDef(c.defId).name));
    if (chainFrom.some((n) => owned.has(n))) return { ...empty, free: true };
  }
  const bank = cost.coins ?? 0;
  if (bank > p.coins) return null;

  const units: Resource[] = [];
  for (const [r, n] of Object.entries(cost.resources ?? {}) as [Resource, number][]) for (let i = 0; i < n; i++) units.push(r);
  if (units.length === 0) return { ...empty, coinsToBank: bank };

  const toSlots = (list: Produce[], owner: Slot['owner']): Slot[] =>
    list.map((e) => ({ options: e.options, remaining: e.amount, ...(e.options.length === 1 ? { chosen: e.options[0] } : {}), owner }));
  const slots: Slot[] = [
    ...toSlots(productionOf(s, seat, false), 'self'),
    ...toSlots(productionOf(s, leftOf(s, seat), true), 'left'),
    ...toSlots(productionOf(s, rightOf(s, seat), true), 'right'),
  ];
  const price = { left: {} as Record<string, number>, right: {} as Record<string, number> };
  for (const r of new Set(units)) {
    price.left[r] = tradePrice(s, seat, 'left', r);
    price.right[r] = tradePrice(s, seat, 'right', r);
  }

  const budget = p.coins - bank;
  let best: { cost: number; assign: Slot['owner'][] } | null = null;
  const assign: Slot['owner'][] = [];

  const dfs = (i: number, spent: number) => {
    if (spent > budget || (best && spent >= best.cost)) return;
    if (i === units.length) {
      best = { cost: spent, assign: [...assign] };
      return;
    }
    const r = units[i];
    for (const slot of slots) {
      if (slot.remaining <= 0 || !slot.options.includes(r) || (slot.chosen && slot.chosen !== r)) continue;
      const prevChosen = slot.chosen;
      slot.remaining--;
      slot.chosen = r;
      assign.push(slot.owner);
      dfs(i + 1, spent + (slot.owner === 'self' ? 0 : price[slot.owner][r]));
      assign.pop();
      slot.chosen = prevChosen;
      slot.remaining++;
    }
  };
  dfs(0, 0);
  if (!best) return null;

  const plan: PaymentPlan = { ...empty, coinsToBank: bank };
  (best as { assign: Slot['owner'][] }).assign.forEach((owner, i) => {
    if (owner === 'self') return;
    const r = units[i];
    const bucket = owner === 'left' ? plan.buyLeft : plan.buyRight;
    bucket[r] = (bucket[r] ?? 0) + 1;
    if (owner === 'left') plan.coinsToLeft += price.left[r];
    else plan.coinsToRight += price.right[r];
  });
  return plan;
}
