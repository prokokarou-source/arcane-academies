import type { Action, Card, CardDef, CountTarget, GameState, PaymentPlan, PlayerState, Term } from './types';
import { cardDef } from './data/cards';
import { academyDef } from './data/academies';
import { leftOf, planPayment, rightOf, validatePayment } from './payment';
import { hasPower } from './powers';
import { resolveDuels } from './duels';
import { dealTerm } from './setup';

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

const FREE: PaymentPlan = { buyLeft: {}, buyRight: {}, coinsToLeft: 0, coinsToRight: 0, coinsToBank: 0, free: true };

/** Seats that must act in the current phase. */
export function actingSeats(s: GameState): number[] {
  if (s.phase === 'ended') return [];
  if (s.phase === 'bonus') return s.players.filter((p) => s.kept[p.seat]).map((p) => p.seat);
  if (s.phase === 'discard') return s.players.filter((p) => (s.discardPicks?.[p.seat] ?? 0) > 0).map((p) => p.seat);
  return s.players.map((p) => p.seat);
}

const owns = (p: PlayerState, name: string) => p.built.some((c) => cardDef(c.defId).name === name);

/** Discarded cards a seat may build for free (not one it already owns by name). */
export function discardChoices(s: GameState, seat: number): Card[] {
  const p = s.players[seat];
  return s.archive.filter((c) => !owns(p, cardDef(c.defId).name));
}

/** Cards a seat chooses from right now: its hand, its kept last card (bonus) or the discard pile (discard). */
export function cardsInPlay(s: GameState, seat: number): Card[] {
  if (s.phase === 'bonus') return s.kept[seat] ? [s.kept[seat]!] : [];
  if (s.phase === 'discard') return discardChoices(s, seat);
  return s.players[seat].hand;
}

/** True when an academy power lets this seat build the card for free right now. */
export function freeBuild(s: GameState, seat: number, def: CardDef): boolean {
  if (s.phase !== 'picking' && s.phase !== 'bonus') return false;
  const p = s.players[seat];
  if (hasPower(s, seat, 'freeNewFamily') && !p.built.some((c) => cardDef(c.defId).family === def.family)) return true;
  if (s.phase === 'picking' && s.turn === 1 && hasPower(s, seat, 'freeFirstTurn')) return true;
  if (s.phase === 'picking' && s.turn === 6 && hasPower(s, seat, 'freeSixthTurn')) return true;
  return false;
}

/** Every legal action for a seat right now (build / tower / sell), with payment plans. */
export function legalActions(s: GameState, seat: number): Action[] {
  if (!actingSeats(s).includes(seat)) return [];
  if (s.phase === 'discard') return discardChoices(s, seat).map((c) => ({ type: 'build', cardUid: c.uid, payment: FREE }));
  const p = s.players[seat];
  const stages = academyDef(p.academyId).sides[p.side];
  const nextStage = stages[p.towerStages];
  const towerPlan = nextStage ? planPayment(s, seat, nextStage.cost) : null;
  const out: Action[] = [];
  for (const c of cardsInPlay(s, seat)) {
    const def = cardDef(c.defId);
    if (!owns(p, def.name)) {
      const plan = freeBuild(s, seat, def) ? FREE : planPayment(s, seat, def.cost, def.chainFrom);
      if (plan) out.push({ type: 'build', cardUid: c.uid, payment: plan });
    }
    if (towerPlan) out.push({ type: 'tower', cardUid: c.uid, payment: towerPlan });
    out.push({ type: 'sell', cardUid: c.uid });
  }
  return out;
}

const isFree = (pl: PaymentPlan) =>
  pl.free && pl.coinsToBank === 0 && pl.coinsToLeft === 0 && pl.coinsToRight === 0 && !Object.keys(pl.buyLeft).length && !Object.keys(pl.buyRight).length;

/**
 * Lock in the pick of a seat for this turn. The action type and card must be offered by legalActions;
 * for build/tower any valid payment plan is accepted (players may edit trades). Throws IllegalActionError otherwise.
 */
export function submitAction(s: GameState, seat: number, action: Action): GameState {
  const offered = legalActions(s, seat).some((a) => a.type === action.type && a.cardUid === action.cardUid);
  let ok = offered;
  if (ok && (action.type === 'build' || action.type === 'tower')) {
    const p = s.players[seat];
    const card = cardsInPlay(s, seat).find((c) => c.uid === action.cardUid)!;
    const def = cardDef(card.defId);
    if (action.type === 'build' && (s.phase === 'discard' || freeBuild(s, seat, def)) && isFree(action.payment)) ok = true;
    else if (s.phase === 'discard') ok = false;
    else {
      const cost = action.type === 'build' ? def.cost : academyDef(p.academyId).sides[p.side][p.towerStages].cost;
      ok = validatePayment(s, seat, cost, action.type === 'build' ? def.chainFrom : undefined, action.payment);
    }
  }
  if (!ok) {
    throw new IllegalActionError(`Seat ${seat} cannot ${action.type} ${action.cardUid}`);
  }
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, pending: action } : p)) };
}

export function allSubmitted(s: GameState): boolean {
  const seats = actingSeats(s);
  return seats.length > 0 && seats.every((seat) => s.players[seat].pending);
}

const countOf = (s: GameState, seat: number, what: CountTarget) =>
  what === 'towerStage' ? s.players[seat].towerStages : s.players[seat].built.filter((c) => cardDef(c.defId).family === what).length;

/** Count a target for a seat over a scope (self, neighbors, or both). */
export function scopeCount(s: GameState, seat: number, what: CountTarget, scope: 'self' | 'selfAndNeighbors' | 'neighbors'): number {
  const others = [...new Set([leftOf(s, seat), rightOf(s, seat)])].filter((n) => n !== seat);
  const self = scope === 'neighbors' ? 0 : countOf(s, seat, what);
  const nb = scope === 'self' ? 0 : others.reduce((sum, n) => sum + countOf(s, n, what), 0);
  return self + nb;
}

const paid = (pl: PaymentPlan) => pl.coinsToBank + pl.coinsToLeft + pl.coinsToRight;

/** Resolve the current turn once every acting seat has submitted. */
export function resolveTurn(s: GameState): GameState {
  if (!allSubmitted(s)) throw new IllegalActionError('Not every seat has submitted');
  const phase = s.phase;
  const before = s;
  const coins = s.players.map((p) => p.coins);
  const players: PlayerState[] = s.players.map((p) => ({ ...p, hand: [...p.hand], built: [...p.built], towerCards: [...p.towerCards], flags: { ...p.flags } }));
  const kept = [...s.kept];
  let archive = [...s.archive];
  const log = [...s.log];
  const picks = s.players.map((p) => s.discardPicks?.[p.seat] ?? 0);
  const builtNow: { seat: number; card: Card }[] = [];
  const stagesNow: number[] = [];

  for (const seat of actingSeats(s)) {
    const p = players[seat];
    const a = p.pending!;
    let card: Card;
    if (phase === 'bonus') {
      card = kept[seat]!;
      kept[seat] = null;
    } else if (phase === 'discard') {
      card = archive.find((c) => c.uid === a.cardUid)!;
      archive = archive.filter((c) => c.uid !== a.cardUid);
      picks[seat] -= 1;
    } else {
      card = p.hand.find((c) => c.uid === a.cardUid)!;
      p.hand = p.hand.filter((c) => c.uid !== a.cardUid);
    }
    const name = cardDef(card.defId).name;
    if (a.type === 'sell') {
      archive.push(card);
      coins[seat] += 3;
      log.push({ term: s.term, turn: s.turn, seat, text: `sold ${name}` });
    } else {
      const pl = a.payment;
      coins[seat] -= paid(pl);
      coins[leftOf(before, seat)] += pl.coinsToLeft;
      coins[rightOf(before, seat)] += pl.coinsToRight;
      if (a.type === 'build') {
        p.built.push(card);
        builtNow.push({ seat, card });
        log.push({ term: s.term, turn: s.turn, seat, text: phase === 'discard' ? `built ${name} from the discard pile` : `built ${name}` });
      } else {
        p.towerCards.push(card);
        p.towerStages += 1;
        stagesNow.push(seat);
        log.push({ term: s.term, turn: s.turn, seat, text: `raised tower stage ${p.towerStages}` });
      }
    }
    p.pending = undefined;
  }

  const spent = s.players.map((p) => (p.pending && 'payment' in p.pending ? paid(p.pending.payment) : 0));
  if (s.players.some((p, i) => spent[i] > p.coins)) {
    throw new IllegalActionError('A pending action spends more coins than the seat had at the start of the turn');
  }

  let next: GameState = { ...s, players: players.map((p, i) => ({ ...p, coins: coins[i] })), kept, archive, log };

  // Immediate effects of cards and tower levels built this turn (counted after all placements).
  const extra = next.players.map(() => 0);
  for (const b of builtNow) {
    for (const e of cardDef(b.card.defId).effects) {
      if (e.kind === 'coins') extra[b.seat] += e.amount;
      if (e.kind === 'coinsPer') extra[b.seat] += e.per * scopeCount(next, b.seat, e.what, e.scope);
    }
  }
  for (const seat of stagesNow) {
    const p = next.players[seat];
    for (const e of academyDef(p.academyId).sides[p.side][p.towerStages - 1].effects) {
      if (e.kind === 'coins') extra[seat] += e.amount;
      if (e.kind === 'buildDiscard') picks[seat] += 1;
    }
  }
  next = { ...next, players: next.players.map((p, i) => ({ ...p, coins: p.coins + extra[i] })) };

  // Free builds from the discard pile come right away; with nothing to take, they are lost.
  const owed = picks.map((n, seat) => (n > 0 && discardChoices(next, seat).length > 0 ? n : 0));
  const resume = phase === 'discard' ? (s.resume ?? 'advance') : phase === 'bonus' ? 'endTerm' : 'advance';
  if (owed.some((n) => n > 0)) return { ...next, phase: 'discard', discardPicks: owed, resume };
  next = { ...next, discardPicks: owed };
  return resume === 'endTerm' ? endTerm(next) : advance({ ...next, phase: 'picking' });
}

function advance(s: GameState): GameState {
  if (s.turn < 6) {
    const hands = s.players.map(() => [] as Card[]);
    for (const p of s.players) {
      const to = s.term === 2 ? rightOf(s, p.seat) : leftOf(s, p.seat);
      hands[to] = p.hand;
    }
    return { ...s, turn: s.turn + 1, players: s.players.map((p, i) => ({ ...p, hand: hands[i] })) };
  }
  // After turn 6: seats that may play their last card do so in a bonus turn.
  const kept = s.players.map((p) => (p.hand.length && hasPower(s, p.seat, 'playLastCard') ? p.hand[0] : null));
  if (kept.some((k) => k)) {
    return { ...s, phase: 'bonus', kept, players: s.players.map((p, i) => (kept[i] ? { ...p, hand: [] } : p)) };
  }
  return endTerm(s);
}

/** End of term: discard the last cards, duels, then the next term or the end of the game. */
function endTerm(s: GameState): GameState {
  const archive = [...s.archive, ...s.players.flatMap((p) => p.hand), ...s.kept.filter((k): k is Card => !!k)];
  let next: GameState = { ...s, archive, kept: s.players.map(() => null), players: s.players.map((p) => ({ ...p, hand: [] })) };
  next = resolveDuels(next, s.term);
  if (s.term === 3) return { ...next, phase: 'ended' };
  return { ...dealTerm(next, (s.term + 1) as Term), phase: 'picking' };
}
