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

/** Production of a seat (home resource, built cards, built tower levels). Neighbors may buy all of it. */
export function productionOf(s: GameState, seat: number): Produce[] {
  return [{ kind: 'produce', options: [academyDef(s.players[seat].academyId).home], amount: 1 }, ...effectsOf(s, seat).filter((e): e is Produce => e.kind === 'produce')];
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
    ...toSlots(productionOf(s, seat), 'self'),
    ...toSlots(productionOf(s, leftOf(s, seat)), 'left'),
    ...toSlots(productionOf(s, rightOf(s, seat)), 'right'),
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

/** True when the produce effects can supply every unit (each choice producer picks one resource). */
function canCover(list: Produce[], units: Resource[]): boolean {
  const slots = list.map((e) => ({ options: e.options, remaining: e.amount, chosen: e.options.length === 1 ? e.options[0] : undefined as Resource | undefined }));
  const dfs = (i: number): boolean => {
    if (i === units.length) return true;
    const r = units[i];
    for (const sl of slots) {
      if (sl.remaining <= 0 || !sl.options.includes(r) || (sl.chosen && sl.chosen !== r)) continue;
      const prev = sl.chosen;
      sl.remaining--;
      sl.chosen = r;
      if (dfs(i + 1)) return true;
      sl.chosen = prev;
      sl.remaining++;
    }
    return false;
  };
  return dfs(0);
}

const expand = (rec: Partial<Record<Resource, number>>): Resource[] | null => {
  const out: Resource[] = [];
  for (const [r, n] of Object.entries(rec) as [Resource, number][]) {
    if (!Number.isInteger(n) || n < 0) return null;
    for (let i = 0; i < n; i++) out.push(r);
  }
  return out;
};

/**
 * Check a payment plan chosen by a player (it need not be the cheapest one, so trades can be edited).
 * Valid when: bank coins match the cost, each purchase is within the neighbor's buyable production at the
 * correct price, purchases do not exceed the cost, own production covers the rest, and the seat can afford it.
 */
export function validatePayment(s: GameState, seat: number, cost: Cost, chainFrom: string[] | undefined, plan: PaymentPlan): boolean {
  const p = s.players[seat];
  const noTrade = plan.coinsToLeft === 0 && plan.coinsToRight === 0 && !expand(plan.buyLeft)?.length && !expand(plan.buyRight)?.length;
  if (plan.free) {
    const owned = new Set(p.built.map((c) => cardDef(c.defId).name));
    return !!chainFrom?.some((n) => owned.has(n)) && plan.coinsToBank === 0 && noTrade;
  }
  if (plan.coinsToBank !== (cost.coins ?? 0)) return false;
  const need: Partial<Record<Resource, number>> = { ...(cost.resources ?? {}) };
  for (const side of ['left', 'right'] as const) {
    const bought = expand(side === 'left' ? plan.buyLeft : plan.buyRight);
    if (!bought) return false;
    const neighbor = side === 'left' ? leftOf(s, seat) : rightOf(s, seat);
    if (neighbor === seat && bought.length) return false;
    const price = bought.reduce((sum, r) => sum + tradePrice(s, seat, side, r), 0);
    if (price !== (side === 'left' ? plan.coinsToLeft : plan.coinsToRight)) return false;
    if (!canCover(productionOf(s, neighbor), bought)) return false;
    for (const r of bought) {
      need[r] = (need[r] ?? 0) - 1;
      if ((need[r] ?? 0) < 0) return false;
    }
  }
  const rest = expand(need);
  if (!rest || !canCover(productionOf(s, seat), rest)) return false;
  return plan.coinsToBank + plan.coinsToLeft + plan.coinsToRight <= p.coins;
}
