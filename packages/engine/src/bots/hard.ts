import type { Action, Card, CardDef, Discipline, Effect, GameState, PaymentPlan, PowerId, Resource, Term, TowerStage } from '../types';
import { RESOURCES, DISCIPLINES, RARE_RESOURCES } from '../types';
import { cardsInPlay, legalActions, resolveTurn, scopeCount } from '../actions';
import { cardDef, CARDS, PATRONS } from '../data/cards';
import { academyDef } from '../data/academies';
import { effectsOf, leftOf, planPayment, rightOf, tradePrice, validatePayment } from '../payment';
import { nextRandom } from '../rng';
import { botPick } from './bot';

/*
 * Hard bot.
 *
 * It values a whole position for a seat in Renown-equivalents (V): the points it would score now,
 * plus what its position is likely to be worth later — production that saves trades for the cards
 * still to come, tower stages it can still raise, duel standing for every term not yet fought,
 * research sets it is building towards, chains into later cards, academy powers, and coins.
 * A pick is scored as V after the pick, plus how much taking the card hurts the player the hand
 * goes to. The best few picks are then checked by playing out the rest of the term (only with
 * hands the bot has actually seen; unseen hands are filled from cards it has not seen yet).
 *
 * To feel human it has a game plan picked from the seed (duelist / scholar / builder / merchant)
 * that tilts its taste a little, and it picks at random among moves that are about equally good.
 * Everything is seeded from the game state, so a pick is fully deterministic.
 */

/** Weights, in Renown-equivalents. Exported so the arena can tune them by self-play. */
/** Tuned by self-play against the previous Hard bot (2026-11, packages/sim arena). */
export const HARD_WEIGHTS = {
  /** Share of future picks that become card builds needing resources. */
  buildFrac: 0.85,
  /** Coin value of a future trade coin. */
  tradeCoin: 0.42,
  /** Cost of a future card we cannot get the resources for at all. */
  block: 2.1,
  /** Weight of the remaining tower stages (option value) before they are built. */
  towerOpt: 0.7,
  /** Bonus for a tower stage per stage the tower is behind schedule (x1.5 in Term III). */
  behind: 1.6,
  /** Chance kept per tower-stage resource unit that neither the seat nor its neighbors produce yet. */
  stageGap: 0.5,
  /** Extra value per coin while coins still buy trades (on top of 1/3 at the end). */
  liquidity: 0.1,
  liquidityCap: 9,
  /** Duel standing: sharpness of the win chance and how it blurs with turns left. */
  duelSharp: 1.8,
  duelBlur: 0.3,
  /** Share of future research synergy counted now, and how strongly commitment raises it. */
  resSyn: 0.55,
  resBase: 0.06,
  resPer: 0.05,
  /** Chains into later cards, per chain and per resource unit the free build saves. */
  chain: 0.3,
  chainUnit: 0.25,
  /** Taking a card the next player wants. */
  deny: 0.5,
  /** Coins handed to neighbors through trades help rivals. */
  gift: 0.2,
  /** Moves this close to the best are "about equal" and picked among at random. */
  jitter: 0.2,
  /** How many of the best moves are checked by playing out the rest of the term (0 or 1 = off). */
  lookahead: 3,
  /** Work budget per decision, in simulated seat-picks over all playouts (keeps phones fast). */
  lookaheadPicks: 75,
  /** Weight of the playout result against the one-move estimate. */
  lookaheadMix: 0.3,
};
export type HardWeights = typeof HARD_WEIGHTS;
type Weights = HardWeights;

const WIN: Record<Term, number> = { 1: 1, 2: 3, 3: 5 };
const paid = (pl: PaymentPlan) => pl.coinsToBank + pl.coinsToLeft + pl.coinsToRight;
const neighbors = (s: GameState, seat: number) => [...new Set([leftOf(s, seat), rightOf(s, seat)])].filter((n) => n !== seat);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ---- game plans ----------------------------------------------------------

export type HardPlan = 'duelist' | 'scholar' | 'builder' | 'merchant';
const PLANS: HardPlan[] = ['duelist', 'scholar', 'builder', 'merchant'];
type Tilt = { duel: number; research: number; tower: number; lore: number; coins: number };
const NEUTRAL: Tilt = { duel: 1, research: 1, tower: 1, lore: 1, coins: 1 };
const TILT: Record<HardPlan, Tilt> = {
  duelist: { ...NEUTRAL, duel: 1.2, research: 0.9 },
  scholar: { ...NEUTRAL, duel: 0.9, research: 1.25 },
  builder: { ...NEUTRAL, research: 0.9, tower: 1.2, lore: 1.1 },
  merchant: { ...NEUTRAL, coins: 1.2 },
};

const mix = (a: number, b: number) => {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
};

/** The game plan of a seat, fixed for the whole game by the seed. */
export function hardPlanOf(s: GameState, seat: number): HardPlan {
  const [r] = nextRandom(mix(s.seed, seat * 977 + 13));
  return PLANS[Math.floor(r * PLANS.length)];
}

// ---- cached effects ------------------------------------------------------

type Produce = Extract<Effect, { kind: 'produce' }>;
type Eff = { stages: number; size: number; produce: Produce[]; duel: number; discount: { basic: Set<string>; rare: Set<string> } };
/** Effects per built-cards array (the engine never edits one in place once a turn is resolved). */
const effCache = new WeakMap<Card[], Eff>();
function eff(s: GameState, seat: number): Eff {
  const p = s.players[seat];
  const hit = effCache.get(p.built);
  if (hit && hit.stages === p.towerStages && hit.size === p.built.length) return hit;
  const all = effectsOf(s, seat);
  const out: Eff = {
    stages: p.towerStages,
    size: p.built.length,
    produce: [{ kind: 'produce', options: [academyDef(p.academyId).home], amount: 1 }, ...all.filter((e): e is Produce => e.kind === 'produce')],
    duel: all.reduce((sum, e) => sum + (e.kind === 'duel' ? e.amount : 0), 0),
    discount: { basic: new Set(), rare: new Set() },
  };
  for (const e of all) if (e.kind === 'tradeDiscount') for (const side of e.sides) out.discount[e.group].add(side);
  effCache.set(p.built, out);
  return out;
}
const isRare = (r: Resource) => (RARE_RESOURCES as readonly string[]).includes(r);

// ---- future demand for resources -----------------------------------------

/** demand[t][r][k] = share of term-t card copies (at this player count) needing exactly k units of r. */
type Demand = Record<Term, Record<Resource, number[]>>;
const demandCache = new Map<number, Demand>();
function demandFor(n: number): Demand {
  const hit = demandCache.get(n);
  if (hit) return hit;
  const d = {} as Demand;
  for (const t of [1, 2, 3] as Term[]) {
    const row = {} as Record<Resource, number[]>;
    for (const r of RESOURCES) row[r] = [0, 0, 0, 0, 0, 0];
    let total = 0;
    const add = (cost: Partial<Record<Resource, number>> | undefined, w: number) => {
      total += w;
      for (const [r, k] of Object.entries(cost ?? {}) as [Resource, number][]) row[r][Math.min(5, k)] += w;
    };
    for (const def of CARDS) {
      if (def.term !== t) continue;
      const copies = def.minPlayers.filter((m) => m <= n).length;
      if (copies) add(def.cost.resources, copies);
    }
    if (t === 3) for (const p of PATRONS) add(p.cost.resources, (n + 2) / PATRONS.length);
    for (const r of RESOURCES) row[r] = row[r].map((x) => x / total);
    d[t] = row;
  }
  demandCache.set(n, d);
  return d;
}

/** Picks the seat still makes after the current one, per term. */
function picksLeft(s: GameState): Record<Term, number> {
  const out: Record<Term, number> = { 1: 0, 2: 0, 3: 0 };
  if (s.phase === 'ended') return out;
  for (let t = s.term; t <= 3; t++) out[t as Term] = t === s.term ? (s.phase === 'picking' ? 6 - s.turn : 0) : 6;
  return out;
}
const totalLeft = (pl: Record<Term, number>) => pl[1] + pl[2] + pl[3];

type Supply = { own: Record<Resource, number>; nb: Record<Resource, number>; price: Record<Resource, number> };

function supplyOf(s: GameState, seat: number): Supply {
  const own = {} as Record<Resource, number>;
  const nb = {} as Record<Resource, number>;
  const price = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    own[r] = 0;
    nb[r] = 0;
    price[r] = 2;
  }
  const mine = eff(s, seat);
  for (const e of mine.produce) for (const r of e.options) own[r] += e.amount;
  const L = leftOf(s, seat);
  const R = rightOf(s, seat);
  const sides: [number, 'left' | 'right'][] = L === R ? [[L, 'left']] : [[L, 'left'], [R, 'right']];
  for (const [n, side] of sides) {
    if (n === seat) continue;
    const prod = eff(s, n).produce;
    for (const r of RESOURCES) {
      let u = 0;
      for (const e of prod) if (e.options.includes(r)) u += e.amount;
      if (u > 0) {
        nb[r] += u;
        price[r] = Math.min(price[r], mine.discount[isRare(r) ? 'rare' : 'basic'].has(side) ? 1 : 2);
      }
    }
  }
  return { own, nb, price };
}

/** Expected cost of covering k units of r with what the seat and its neighbors produce. */
function cover(sup: Supply, r: Resource, k: number, W: Weights): number {
  const missing = k - sup.own[r];
  if (missing <= 0) return 0;
  if (sup.nb[r] >= missing) return Math.min(W.block, missing * sup.price[r] * W.tradeCoin);
  return W.block;
}

/** Trade cost of a tower stage's resources, and how many units nobody nearby makes yet. */
function stageCover(sup: Supply, st: TowerStage, W: Weights): { cost: number; gap: number } {
  let cost = 0;
  let gap = 0;
  for (const [r, k] of Object.entries(st.cost.resources ?? {}) as [Resource, number][]) {
    const missing = k - sup.own[r];
    if (missing <= 0) continue;
    const buy = Math.min(missing, sup.nb[r]);
    cost += buy * sup.price[r] * W.tradeCoin;
    gap += missing - buy;
  }
  return { cost, gap };
}

/** Expected cost of the trades and lost cards the seat faces for the rest of the game. */
function productionPenalty(s: GameState, sup: Supply, left: Record<Term, number>, W: Weights): number {
  const d = demandFor(s.players.length);
  let v = 0;
  for (const t of [1, 2, 3] as Term[]) {
    if (!left[t]) continue;
    const builds = left[t] * W.buildFrac;
    for (const r of RESOURCES) {
      const row = d[t][r];
      for (let k = 1; k < row.length; k++) if (row[k]) v += builds * row[k] * cover(sup, r, k, W);
    }
  }
  return v;
}

// ---- research --------------------------------------------------------------

function researchCounts(s: GameState, seat: number): { c: number[]; wild: number } {
  const c = [0, 0, 0];
  const p = s.players[seat];
  for (const card of p.built) for (const e of cardDef(card.defId).effects) if (e.kind === 'research') c[DISCIPLINES.indexOf(e.discipline as Discipline)]++;
  let wild = 0;
  for (const st of academyDef(p.academyId).sides[p.side].slice(0, p.towerStages)) for (const e of st.effects) if (e.kind === 'researchAny') wild++;
  return { c, wild };
}
const rawResearch = (a: number, b: number, c: number) => 2 * (a + b + c) + 6 * Math.min(a, b, c) + 5 * ((a >= 3 ? 1 : 0) + (b >= 3 ? 1 : 0) + (c >= 3 ? 1 : 0));
/** Research score with `extra` symbols placed where they score the most. */
function bestResearch(c: number[], extra: number): number {
  let best = 0;
  for (let i = 0; i <= extra; i++) for (let j = 0; i + j <= extra; j++) best = Math.max(best, rawResearch(c[0] + i, c[1] + j, c[2] + extra - i - j));
  return best;
}

// ---- tower ---------------------------------------------------------------

function powerWorth(s: GameState, seat: number, power: PowerId, left: Record<Term, number>): number {
  const termEnds = s.phase === 'ended' ? 0 : 3 - s.term + (s.phase === 'picking' ? 1 : 0);
  switch (power) {
    case 'playLastCard':
      return 2.2 * termEnds;
    case 'freeNewFamily': {
      const owned = new Set(s.players[seat].built.map((c) => cardDef(c.defId).family));
      return Math.min(7 - owned.size, totalLeft(left) / 2) * 1.1;
    }
    case 'freeFirstTurn':
      return 2.5 * (3 - s.term);
    case 'freeSixthTurn':
      return 2.5 * Math.max(0, termEnds - (s.phase === 'picking' && s.turn === 6 ? 1 : 0));
  }
}

/** What a tower stage adds once built (beyond production, which V counts on its own). */
function stageWorth(s: GameState, seat: number, st: TowerStage, left: Record<Term, number>, tilt: Tilt): number {
  const later = totalLeft(left);
  let v = st.power ? powerWorth(s, seat, st.power, left) : 0;
  for (const e of st.effects) {
    if (e.kind === 'renown') v += e.amount;
    if (e.kind === 'coins') v += e.amount * 0.4;
    if (e.kind === 'duel') v += e.amount * 1.2 * Math.min(1, later / 6 + 0.3) * tilt.duel;
    if (e.kind === 'produce') v += Math.min(2.5, later * 0.18);
    if (e.kind === 'researchAny') v += 3.5;
    if (e.kind === 'buildDiscard') v += 2.5;
  }
  return v * tilt.tower;
}

/** Card name -> later cards it builds for free. */
const CHAINS = new Map<string, CardDef[]>();
for (const def of CARDS) for (const from of def.chainFrom ?? []) CHAINS.set(from, [...(CHAINS.get(from) ?? []), def]);

// ---- position value ------------------------------------------------------

/**
 * Value of the position for a seat, in Renown-equivalents. At the end of the game it equals the
 * seat's final score (with coins counted at face value / 3).
 */
export function positionValue(s: GameState, seat: number, W: Weights = HARD_WEIGHTS, tilt: Tilt = NEUTRAL): number {
  const p = s.players[seat];
  const left = picksLeft(s);
  const later = totalLeft(left);
  const stages = academyDef(p.academyId).sides[p.side];
  let v = 0;

  // Points already on the table.
  for (const st of stages.slice(0, p.towerStages)) {
    for (const e of st.effects) if (e.kind === 'renown') v += e.amount * tilt.tower;
    if (st.power) v += powerWorth(s, seat, st.power, left);
  }
  for (const c of p.built) {
    const def = cardDef(c.defId);
    for (const e of def.effects) {
      if (e.kind === 'renown') v += e.amount * (def.family === 'lore' ? tilt.lore : 1);
      if (e.kind === 'renownPer') v += e.per * scopeCount(s, seat, e.what, e.scope);
      if (e.kind === 'tradeDiscount') v += Math.min(2.2, later * (e.group === 'rare' ? 0.12 : 0.1));
    }
  }
  for (const x of s.duelTokens[seat]) v += x;

  // Research now, plus the sets it is building towards.
  const rs = researchCounts(s, seat);
  const now = bestResearch(rs.c, rs.wild);
  v += now;
  const symbols = rs.c[0] + rs.c[1] + rs.c[2] + rs.wild;
  if (later > 0) {
    const e = Math.min(5, later * W.buildFrac * (W.resBase + W.resPer * symbols));
    const lo = Math.floor(e);
    const syn = (x: number) => bestResearch(rs.c, rs.wild + x) - now - 2 * x;
    const synergy = syn(lo) + (e - lo) * (syn(lo + 1) - syn(lo));
    v += W.resSyn * tilt.research * synergy;
  }

  // Coins: 1/3 at the end, worth a bit more while they still buy trades.
  const liquid = Math.min(p.coins, W.liquidityCap) * W.liquidity * Math.min(1, later / 12);
  v += p.coins / 3 + liquid * tilt.coins;

  if (s.phase === 'ended') return v;

  // Duels not fought yet.
  const me = eff(s, seat).duel;
  for (const n of neighbors(s, seat)) {
    const d = me - eff(s, n).duel;
    for (let t = s.term; t <= 3; t++) {
      const until = (t - s.term) * 6 + (s.phase === 'picking' ? 6 - s.turn : 0);
      const x = (W.duelSharp * d) / Math.sqrt(1 + W.duelBlur * until);
      // Ties score 0: count the win and loss chances around the even point.
      v += tilt.duel * (WIN[t as Term] * sigmoid(x - 0.6) - sigmoid(-x - 0.6));
    }
  }
  if (later === 0) return v;

  // Trades and lost cards still ahead.
  const sup = supplyOf(s, seat);
  v -= productionPenalty(s, sup, left, W);

  // Tower stages still to raise: worth something now, more once built.
  // A stage nobody nearby can supply yet also holds back every stage after it.
  let k = 0;
  let reach = 1;
  for (const st of stages.slice(p.towerStages)) {
    k++;
    const feasible = clamp01((later - 2 * (k - 1)) / 3);
    if (!feasible) break;
    const { cost, gap } = stageCover(sup, st, W);
    reach *= Math.pow(W.stageGap, gap);
    v += W.towerOpt * feasible * reach * Math.max(0, stageWorth(s, seat, st, left, tilt) - cost);
  }

  // Chains into cards still to come.
  const owned = p.built.map((c) => cardDef(c.defId).name);
  for (const name of owned) {
    for (const def of CHAINS.get(name) ?? []) {
      if (def.term < s.term || owned.includes(def.name)) continue;
      const size = Object.values(def.cost.resources ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      v += (def.term === s.term ? 0.4 : 1) * (W.chain + W.chainUnit * size);
    }
  }
  return v;
}

// ---- applying a pick for one seat ----------------------------------------

/** The state as the seat sees it right after its own pick resolves (others unchanged, apart from trade coins). */
function afterPick(s: GameState, seat: number, a: Action, hand: Card[] = cardsInPlay(s, seat)): GameState {
  const card = hand.find((c) => c.uid === a.cardUid)!;
  const players = s.players.map((p) => ({ ...p }));
  const me = players[seat];
  me.hand = me.hand.filter((c) => c.uid !== a.cardUid);
  if (a.type === 'sell') me.coins += 3;
  else {
    me.coins -= paid(a.payment);
    players[leftOf(s, seat)].coins += a.payment.coinsToLeft;
    players[rightOf(s, seat)].coins += a.payment.coinsToRight;
    if (a.type === 'build') me.built = [...me.built, card];
    else {
      me.towerCards = [...me.towerCards, card];
      me.towerStages += 1;
    }
  }
  const next: GameState = { ...s, players };
  // Coins the build pays out right away.
  if (a.type === 'build') {
    for (const e of cardDef(card.defId).effects) {
      if (e.kind === 'coins') me.coins += e.amount;
      if (e.kind === 'coinsPer') me.coins += e.per * scopeCount(next, seat, e.what, e.scope);
    }
  } else if (a.type === 'tower') {
    for (const e of academyDef(me.academyId).sides[me.side][me.towerStages - 1].effects) if (e.kind === 'coins') me.coins += e.amount;
  }
  return next;
}

// ---- what a rival wants --------------------------------------------------

/** Value a seat gets from building each card of a hand (0 when it cannot build it or gains nothing). */
function wantsOf(s: GameState, seat: number, hand: Card[], W: Weights): Map<string, number> {
  const out = new Map<string, number>();
  const base = positionValue(s, seat, W);
  const p = s.players[seat];
  for (const c of hand) {
    const def = cardDef(c.defId);
    const plan = p.built.some((b) => cardDef(b.defId).name === def.name) ? null : planPayment(s, seat, def.cost, def.chainFrom);
    if (!plan) {
      out.set(c.uid, 0);
      continue;
    }
    const after = afterPick(s, seat, { type: 'build', cardUid: c.uid, payment: plan }, hand);
    out.set(c.uid, Math.max(0, positionValue(after, seat, W) - base));
  }
  return out;
}

/** Seat that receives this seat's hand after the turn (none on the last turn of a term). */
const receiverOf = (s: GameState, seat: number): number | null =>
  s.phase !== 'picking' || s.turn >= 6 ? null : s.term === 2 ? rightOf(s, seat) : leftOf(s, seat);

// ---- tower schedule ------------------------------------------------------

/** Tower stages the seat should have once this turn is played. */
function towerTarget(s: GameState, seat: number): number {
  const p = s.players[seat];
  const total = academyDef(p.academyId).sides[p.side].length;
  const done = (s.term - 1) * 6 + s.turn;
  // Spread over the game: stage 1 within Term I for a 3-stage side, the last one before the final turns.
  return Math.min(total, Math.floor((total * done) / 15));
}

// ---- playing out the rest of the term ------------------------------------

/** Cheap greedy pick used inside playouts. */
function quickPick(s: GameState, seat: number, W: Weights): Action | null {
  const acts = legalActions(s, seat);
  let best: Action | null = null;
  let bestV = -Infinity;
  const seen = new Set<string>();
  for (const a of acts) {
    // One tower and one sell option are enough here: which card is burned matters little.
    const key = a.type === 'build' ? a.cardUid : a.type;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = positionValue(afterPick(s, seat, a), seat, W);
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best;
}

/**
 * The state with the hands the seat has not seen replaced by cards it has not seen, so a playout
 * never uses hidden information. Hands the seat held earlier this term are known (less what was taken).
 */
function believedState(s: GameState, seat: number): GameState {
  const n = s.players.length;
  const step = (x: number) => (s.term === 2 ? rightOf(s, x) : leftOf(s, x));
  const known = new Set<number>([seat]);
  let x = seat;
  for (let j = 1; j < Math.min(s.turn, n); j++) {
    x = step(x);
    known.add(x);
  }
  if (known.size === n) return s;
  const visible = new Set<string>();
  for (const k of known) for (const c of s.players[k].hand) visible.add(c.uid);
  for (const p of s.players) for (const c of p.built) visible.add(c.uid);
  for (const c of s.archive) visible.add(c.uid);
  for (const c of s.players[seat].towerCards) visible.add(c.uid);
  const pool: Card[] = [];
  for (const def of CARDS) {
    if (def.term !== s.term) continue;
    def.minPlayers.forEach((m, i) => {
      const uid = `${def.id}#${i}`;
      if (m <= n && !visible.has(uid)) pool.push({ uid, defId: def.id });
    });
  }
  if (s.term === 3) for (const p of PATRONS) if (!visible.has(`${p.id}#0`)) pool.push({ uid: `${p.id}#0`, defId: p.id });
  let r = mix(s.rngState, seat * 7 + s.turn);
  for (let i = pool.length - 1; i > 0; i--) {
    const [u, nx] = nextRandom(r);
    r = nx;
    const j = Math.floor(u * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let at = 0;
  const players = s.players.map((p) => {
    if (known.has(p.seat)) return p;
    const hand = pool.slice(at, at + p.hand.length);
    at += p.hand.length;
    return hand.length === p.hand.length ? { ...p, hand } : p;
  });
  return { ...s, players };
}

/** Play the rest of the term after `first`, then value the position for the seat. */
function playout(belief: GameState, seat: number, first: Action, W: Weights, turns: number): number {
  let s = belief;
  const term = s.term;
  for (let guard = 0; guard < turns && s.phase !== 'ended' && s.term === term; guard++) {
    let next = s;
    for (const p of s.players) {
      // The seat itself plays greedily on its own values; rivals play like Normal (cheap).
      const a = guard === 0 && p.seat === seat ? first : p.seat === seat ? quickPick(s, seat, W) : legalActions(s, p.seat).length ? botPick(s, p.seat, 'normal') : null;
      // Picks come from legalActions, so skip re-validating them.
      if (a) next = { ...next, players: next.players.map((x) => (x.seat === p.seat ? { ...x, pending: a } : x)) };
    }
    s = resolveTurn(next);
  }
  return positionValue(s, seat, W);
}

// ---- the pick ------------------------------------------------------------

/** Among equally priced ways to pay, buy from the neighbor who is the smaller threat. */
function preferWeakerNeighbor(s: GameState, seat: number, a: Action): Action {
  if (a.type !== 'build' && a.type !== 'tower') return a;
  const pl = a.payment;
  if (pl.coinsToLeft + pl.coinsToRight === 0) return a;
  const L = leftOf(s, seat);
  const R = rightOf(s, seat);
  if (L === R) return a;
  const threat = (n: number) => (s.players[n].config.kind === 'archmage' ? -100 : positionValue(s, n));
  const [from, to] = threat(L) > threat(R) ? (['left', 'right'] as const) : (['right', 'left'] as const);
  const p = s.players[seat];
  const def = cardDef(cardsInPlay(s, seat).find((c) => c.uid === a.cardUid)!.defId);
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

export type HardChoice = {
  action: Action;
  plan: HardPlan;
  /** Gap between the two best moves in Renown-equivalents (small = a hard choice, worth a longer think). */
  margin: number;
  /** Moves considered last, best first (for tests and debugging). */
  ranked: { action: Action; value: number }[];
};

/** Score every legal action and choose one. */
export function hardChoose(s: GameState, seat: number, W: Weights = HARD_WEIGHTS): HardChoice {
  const acts = legalActions(s, seat);
  const plan = hardPlanOf(s, seat);
  const tilt = TILT[plan];
  const hand = cardsInPlay(s, seat);
  const recv = receiverOf(s, seat);
  const n = s.players.length;
  const want = recv !== null ? wantsOf(s, recv, hand, W) : null;
  const denyW = recv !== null ? (W.deny * (s.players[recv].config.kind === 'archmage' ? 0.5 : 1)) / Math.sqrt(Math.max(1, n - 2)) : 0;
  const behind = Math.max(0, towerTarget(s, seat) - s.players[seat].towerStages) * (s.term === 3 ? 1.5 : 1);

  let scored = acts.map((a) => {
    let v = positionValue(afterPick(s, seat, a, hand), seat, W, tilt);
    if (a.type !== 'sell') v -= W.gift * (a.payment.coinsToLeft + a.payment.coinsToRight);
    if (a.type === 'tower') v += W.behind * behind;
    if (want) {
      const mine = want.get(a.cardUid) ?? 0;
      let other = 0;
      for (const [uid, w] of want) if (uid !== a.cardUid) other = Math.max(other, w);
      v += denyW * Math.max(0, mine - other);
    }
    return { a, v };
  });
  scored.sort((x, y) => y.v - x.v);

  // Check the best few by playing out the rest of the term.
  const k = Math.min(W.lookahead, scored.length);
  if (k > 1 && s.phase === 'picking' && s.turn < 6) {
    const belief = believedState(s, seat);
    const top = scored.slice(0, k);
    const base = top.map((x) => x.v);
    // Whole turns only (this one included), at least two.
    const turns = Math.max(2, Math.floor(W.lookaheadPicks / (k * n)));
    const outs = top.map((x) => playout(belief, seat, x.a, W, turns));
    top.forEach((x, i) => (x.v = base[i] + W.lookaheadMix * (outs[i] - outs[0] - (base[i] - base[0]))));
    scored = top.sort((x, y) => y.v - x.v);
  }

  const bestV = scored[0].v;
  const close = scored.filter((x) => x.v >= bestV - W.jitter);
  const [r] = nextRandom(mix(s.rngState, seat * 131 + s.term * 17 + s.turn));
  const pick = close[Math.floor(r * close.length)];
  const margin = scored.length > 1 ? bestV - scored[1].v : 99;
  return { action: preferWeakerNeighbor(s, seat, pick.a), plan, margin, ranked: scored.map((x) => ({ action: x.a, value: x.v })) };
}

/** Deterministic Hard pick for a seat. */
export function hardPick(s: GameState, seat: number): Action {
  return hardChoose(s, seat).action;
}

