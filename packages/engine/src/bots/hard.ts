import type { Action, Card, Discipline, Effect, GameState, PaymentPlan, PowerId, Resource, Term } from '../types';
import { RARE_RESOURCES } from '../types';
import { legalActions, scopeCount } from '../actions';
import { cardDef, CARDS } from '../data/cards';
import { academyDef } from '../data/academies';
import { duelPower } from '../duels';
import { hasPower } from '../powers';
import { leftOf, planPayment, productionOf, rightOf, tradePrice, validatePayment } from '../payment';
import { scoreResearch } from '../scoring';

/*
 * Hard bot. Every action is scored in Renown-equivalents as
 *   (what it is worth to me now and later) - (coins it costs, plus the coins it hands to rivals)
 *   + (how much it hurts the player my hand is passed to, who loses the card I take).
 * "Later" covers duel standing for every remaining term, resources my academy stages still need,
 * research sets, chain builds in later terms and the academy powers. Trades go to the weaker neighbor.
 */

const WIN: Record<Term, number> = { 1: 1, 2: 3, 3: 5 };
const paid = (pl: PaymentPlan) => pl.coinsToBank + pl.coinsToLeft + pl.coinsToRight;
const neighbors = (s: GameState, seat: number) => [...new Set([leftOf(s, seat), rightOf(s, seat)])].filter((n) => n !== seat);
/** Turns this seat still plays after the current one. */
const turnsAfter = (s: GameState) => (3 - s.term) * 6 + (6 - s.turn);
/** Seat that receives this seat's hand after the turn (none on the last turn of a term). */
const receiverOf = (s: GameState, seat: number): number | null =>
  s.phase !== 'picking' || s.turn >= 6 ? null : s.term === 2 ? rightOf(s, seat) : leftOf(s, seat);

const withBuilt = (s: GameState, seat: number, card: Card): GameState => ({
  ...s,
  players: s.players.map((p) => (p.seat === seat ? { ...p, built: [...p.built, card] } : p)),
});
const withStage = (s: GameState, seat: number): GameState => ({
  ...s,
  players: s.players.map((p) => (p.seat === seat ? { ...p, towerStages: p.towerStages + 1 } : p)),
});

function researchCounts(s: GameState, seat: number): Record<Discipline, number> {
  const counts: Record<Discipline, number> = { alchemy: 0, astronomy: 0, runes: 0 };
  for (const c of s.players[seat].built) for (const e of cardDef(c.defId).effects) if (e.kind === 'research') counts[e.discipline]++;
  return counts;
}

/** True when one of the seat's academy stages carries this power (built or not). */
function willHave(s: GameState, seat: number, power: PowerId): boolean {
  const p = s.players[seat];
  return academyDef(p.academyId).sides[p.side].some((st) => st.power === power);
}

/**
 * Renown the seat would score from cards and stages if the game ended now
 * (lore, trade, patrons, research, tower) — duels and coins are valued separately.
 */
function staticScore(s: GameState, seat: number): number {
  const p = s.players[seat];
  let v = 0;
  for (const st of academyDef(p.academyId).sides[p.side].slice(0, p.towerStages)) {
    for (const e of st.effects) if (e.kind === 'renown') v += e.amount;
  }
  if (hasPower(s, seat, 'verdantWhiteRenown')) v += scopeCount(s, seat, 'basic', 'self');
  for (const c of p.built) {
    for (const e of cardDef(c.defId).effects) {
      if (e.kind === 'renown') v += e.amount;
      if (e.kind === 'renownPer') v += e.per * scopeCount(s, seat, e.what, e.scope);
    }
  }
  const astral = hasPower(s, seat, 'astralSetBonus') || (willHave(s, seat, 'astralSetBonus') && s.term < 3);
  return v + scoreResearch(researchCounts(s, seat), astral);
}

/** Value of a coin, a bit higher early on while coins still buy trades. */
const coinValue = (s: GameState, seat: number) => (s.players[seat].coins < 4 && s.term < 3 ? 0.45 : 0.36);

/** Resource units still needed by unbuilt academy stages. */
function stageNeeds(s: GameState, seat: number): Partial<Record<Resource, number>> {
  const p = s.players[seat];
  const need: Partial<Record<Resource, number>> = {};
  for (const st of academyDef(p.academyId).sides[p.side].slice(p.towerStages)) {
    for (const [r, n] of Object.entries(st.cost.resources ?? {}) as [Resource, number][]) need[r] = Math.max(need[r] ?? 0, n);
  }
  return need;
}

const units = (list: ReturnType<typeof productionOf>, r: Resource) =>
  list.reduce((sum, e) => sum + (e.options.includes(r) ? e.amount / e.options.length : 0), 0);

function produceValue(s: GameState, seat: number, e: Extract<Effect, { kind: 'produce' }>): number {
  const later = turnsAfter(s);
  if (later === 0) return 0;
  const own = productionOf(s, seat, false);
  const nb = neighbors(s, seat).flatMap((n) => productionOf(s, n, true));
  const need = stageNeeds(s, seat);
  let best = 0;
  for (const r of e.options) {
    const have = units(own, r);
    const rare = (RARE_RESOURCES as readonly string[]).includes(r);
    let v = (rare ? 1.2 : 1) / (1 + have);
    if (units(nb, r) === 0) v *= 1.5;
    v += 0.7 * Math.min(2, Math.max(0, (need[r] ?? 0) - have));
    best = Math.max(best, v);
  }
  const amount = e.amount === 1 ? 1 : 1 + 0.7 * (e.amount - 1);
  return (best * amount + 0.25 * (e.options.length - 1)) * Math.min(1, later / 9);
}

/** Change in duel tokens from adding duel power, over this term and (more loosely) the later ones. */
function duelGain(s: GameState, seat: number, amount: number): number {
  const me = duelPower(s, seat);
  const pyro = hasPower(s, seat, 'pyroDuelBonus') || willHave(s, seat, 'pyroDuelBonus');
  const out = (a: number, b: number, t: Term) => (a > b ? WIN[t] + (pyro ? 1 : 0) : a < b ? -1 : 0);
  let v = 0;
  for (const n of neighbors(s, seat)) {
    const them = duelPower(s, n);
    for (let t = s.term; t <= 3; t++) {
      const term = t as Term;
      const w = t === s.term ? 0.55 + 0.45 * (s.turn / 6) : 0.4;
      v += w * (out(me + amount, them, term) - out(me, them, term));
    }
  }
  return v;
}

/** Later-term cards that this card lets the seat build for free. */
function chainValue(s: GameState, name: string): number {
  let v = 0;
  for (const d of CARDS) {
    if (d.term <= s.term || !d.chainFrom?.includes(name)) continue;
    const size = Object.values(d.cost.resources ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    v += 0.35 * size;
  }
  return Math.min(2.5, v);
}

function powerValue(s: GameState, seat: number, power: PowerId | undefined): number {
  if (!power) return 0;
  const later = turnsAfter(s);
  const termsLeft = 3 - s.term + 1;
  switch (power) {
    case 'pyroDuelBonus':
      return neighbors(s, seat).filter((n) => duelPower(s, seat) >= duelPower(s, n)).length * termsLeft * 0.8;
    case 'hydroTradeBonus':
      return later * 0.15;
    case 'verdantWhiteRenown':
      return scopeCount(s, seat, 'basic', 'self') + (s.term < 3 ? 1 : 0);
    case 'shadowTax':
      return neighbors(s, seat).reduce((sum, n) => sum + Math.min(2, s.players[n].coins), 0) * 0.5;
    case 'astralSetBonus': {
      const c = researchCounts(s, seat);
      return 3 * Math.min(c.alchemy, c.astronomy, c.runes) + (s.term < 3 ? 2 : 0);
    }
    case 'chronoKeep':
      return s.term < 3 ? 3 : 0;
    case 'runeChainCoins':
      return later * 0.1;
  }
}

/** What building a card is worth to a seat, before paying for it. */
function buildValue(s: GameState, seat: number, card: Card): number {
  const def = cardDef(card.defId);
  const after = withBuilt(s, seat, card);
  let v = staticScore(after, seat) - staticScore(s, seat);
  const later = turnsAfter(s);
  for (const e of def.effects) {
    if (e.kind === 'produce') v += produceValue(s, seat, e);
    if (e.kind === 'duel') v += duelGain(s, seat, e.amount);
    if (e.kind === 'coins') v += e.amount * coinValue(s, seat);
    if (e.kind === 'coinsPer') v += e.per * scopeCount(after, seat, e.what, e.scope) * coinValue(s, seat);
    if (e.kind === 'tradeDiscount') v += Math.min(2, later * (e.group === 'rare' ? 0.12 : 0.1));
    if (e.kind === 'research' && s.term < 3) {
      // Room to grow into sets and 3-of-a-kind later.
      const c = researchCounts(s, seat);
      v += (c[e.discipline] < 3 ? 0.8 : 0.3) * (3 - s.term);
    }
    if (e.kind === 'renownPer' && e.what === 'towerStage' && e.scope !== 'neighbors') {
      const p = s.players[seat];
      const left = academyDef(p.academyId).sides[p.side].length - p.towerStages;
      v += e.per * Math.min(left, Math.ceil(later / 3)) * 0.7;
    }
  }
  if (def.term < 3) v += chainValue(s, def.name);
  return v;
}

/** Quick read of how much a seat wants a card (0 for cards it cannot build). */
function wantOf(s: GameState, seat: number, card: Card): number {
  const def = cardDef(card.defId);
  if (s.players[seat].built.some((c) => cardDef(c.defId).name === def.name)) return 0;
  const plan = planPayment(s, seat, def.cost, def.chainFrom);
  if (!plan) return 0;
  return Math.max(0, buildValue(s, seat, card) - paid(plan) * coinValue(s, seat));
}

/** How much taking this card away hurts the receiver: its value over their best other option. */
function denial(s: GameState, receiver: number, hand: Card[], card: Card): number {
  const mine = wantOf(s, receiver, card);
  if (mine <= 0) return 0;
  let other = 0;
  for (const c of hand) if (c.uid !== card.uid) other = Math.max(other, wantOf(s, receiver, c));
  return Math.max(0, mine - other);
}

function stageValue(s: GameState, seat: number): number {
  const p = s.players[seat];
  const stages = academyDef(p.academyId).sides[p.side];
  const st = stages[p.towerStages];
  let v = staticScore(withStage(s, seat), seat) - staticScore(s, seat) + powerValue(s, seat, st.power);
  // Unbuilt stages are wasted at the end: hurry when the turns run out.
  const left = stages.length - p.towerStages;
  if (s.term === 3 && left >= 6 - s.turn + 1) v += 2;
  return v + 0.5;
}

/** Hand the seat chooses from this turn. */
function handOf(s: GameState, seat: number): Card[] {
  return s.phase === 'bonus' ? (s.kept[seat] ? [s.kept[seat]!] : []) : s.players[seat].hand;
}

function actionValue(s: GameState, seat: number, a: Action, recv: number | null, weights: number[]): number {
  const hand = handOf(s, seat);
  const card = hand.find((c) => c.uid === a.cardUid)!;
  const cv = coinValue(s, seat);
  let v: number;
  if (a.type === 'sell') v = 3 * cv;
  else if (a.type === 'chronoKeep') v = 1 + 0.8 * buildValue(s, seat, card);
  else {
    const gift = a.payment.coinsToLeft + a.payment.coinsToRight;
    v = (a.type === 'tower' ? stageValue(s, seat) : buildValue(s, seat, card)) - paid(a.payment) * cv - gift * 0.12;
    if (a.payment.free && hasPower(s, seat, 'runeChainCoins')) v += 2 * cv;
  }
  if (recv !== null) v += weights[recv] * denial(s, recv, hand, card);
  return v;
}

/** Among equally priced ways to pay, buy from the neighbor who is the smaller threat. */
function preferWeakerNeighbor(s: GameState, seat: number, a: Action): Action {
  if (a.type !== 'build' && a.type !== 'tower') return a;
  const pl = a.payment;
  if (pl.coinsToLeft + pl.coinsToRight === 0) return a;
  const L = leftOf(s, seat);
  const R = rightOf(s, seat);
  if (L === R) return a;
  const threat = (n: number) => (s.players[n].config.kind === 'archmage' ? -100 : staticScore(s, n) + s.players[n].coins / 3);
  const [from, to] = threat(L) > threat(R) ? (['left', 'right'] as const) : (['right', 'left'] as const);
  const p = s.players[seat];
  const def = cardDef(handOf(s, seat).find((c) => c.uid === a.cardUid)!.defId);
  const cost = a.type === 'build' ? def.cost : academyDef(p.academyId).sides[p.side][p.towerStages].cost;
  const chain = a.type === 'build' ? def.chainFrom : undefined;
  const fromBuy = from === 'left' ? 'buyLeft' : 'buyRight';
  const toBuy = from === 'left' ? 'buyRight' : 'buyLeft';
  const fromCoins = from === 'left' ? 'coinsToLeft' : 'coinsToRight';
  const toCoins = from === 'left' ? 'coinsToRight' : 'coinsToLeft';
  let plan: PaymentPlan = { ...pl, buyLeft: { ...pl.buyLeft }, buyRight: { ...pl.buyRight } };
  for (const r of Object.keys(pl[fromBuy]) as Resource[]) {
    const price = tradePrice(s, seat, from, r);
    if (tradePrice(s, seat, to, r) !== price) continue;
    for (let i = 0; i < (pl[fromBuy][r] ?? 0); i++) {
      const next: PaymentPlan = {
        ...plan,
        [fromBuy]: { ...plan[fromBuy], [r]: (plan[fromBuy][r] ?? 0) - 1 },
        [toBuy]: { ...plan[toBuy], [r]: (plan[toBuy][r] ?? 0) + 1 },
        [fromCoins]: plan[fromCoins] - price,
        [toCoins]: plan[toCoins] + price,
      };
      if (!next[fromBuy][r]) delete next[fromBuy][r];
      if (!validatePayment(s, seat, cost, chain, next)) break;
      plan = next;
    }
  }
  return { ...a, payment: plan };
}

/** Deterministic Hard pick for a seat. */
export function hardPick(s: GameState, seat: number): Action {
  const acts = legalActions(s, seat);
  const recv = receiverOf(s, seat);
  const weights = s.players.map((p) => (p.config.kind === 'archmage' ? 0.25 : 0.5));
  let best = acts[0];
  let bestV = -Infinity;
  for (const a of acts) {
    const v = actionValue(s, seat, a, recv, weights);
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return preferWeakerNeighbor(s, seat, best);
}
