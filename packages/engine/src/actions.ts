import type { Action, Card, CountTarget, GameState, PaymentPlan, PlayerState, Term } from './types';
import { cardDef } from './data/cards';
import { academyDef } from './data/academies';
import { leftOf, planPayment, rightOf } from './payment';
import { applyPowerOnBuild, hasPower } from './powers';
import { resolveDuels } from './duels';
import { dealTerm } from './setup';

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

/** Seats that must act in the current phase. */
export function actingSeats(s: GameState): number[] {
  if (s.phase === 'ended') return [];
  if (s.phase === 'bonus') return s.players.filter((p) => s.kept[p.seat]).map((p) => p.seat);
  return s.players.map((p) => p.seat);
}

function cardsInPlay(s: GameState, seat: number): Card[] {
  if (s.phase === 'bonus') return s.kept[seat] ? [s.kept[seat]!] : [];
  return s.players[seat].hand;
}

/** Every legal action for a seat right now (build / tower / sell / chronoKeep), with payment plans. */
export function legalActions(s: GameState, seat: number): Action[] {
  if (!actingSeats(s).includes(seat)) return [];
  const p = s.players[seat];
  const owned = new Set(p.built.map((c) => cardDef(c.defId).name));
  const stages = academyDef(p.academyId).sides[p.side];
  const nextStage = stages[p.towerStages];
  const towerPlan = nextStage ? planPayment(s, seat, nextStage.cost) : null;
  const canKeep = s.phase === 'picking' && s.term < 3 && !p.flags.chronoUsed && hasPower(s, seat, 'chronoKeep');
  const out: Action[] = [];
  for (const c of cardsInPlay(s, seat)) {
    const def = cardDef(c.defId);
    if (!owned.has(def.name)) {
      const plan = planPayment(s, seat, def.cost, def.chainFrom);
      if (plan) out.push({ type: 'build', cardUid: c.uid, payment: plan });
    }
    if (towerPlan) out.push({ type: 'tower', cardUid: c.uid, payment: towerPlan });
    out.push({ type: 'sell', cardUid: c.uid });
    if (canKeep) out.push({ type: 'chronoKeep', cardUid: c.uid });
  }
  return out;
}

/** Lock in the pick of a seat for this turn. Throws IllegalActionError unless it is one of legalActions. */
export function submitAction(s: GameState, seat: number, action: Action): GameState {
  const key = JSON.stringify(action);
  if (!legalActions(s, seat).some((a) => JSON.stringify(a) === key)) {
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
  const bonus = s.phase === 'bonus';
  const before = s;
  const coins = s.players.map((p) => p.coins);
  const players: PlayerState[] = s.players.map((p) => ({ ...p, hand: [...p.hand], built: [...p.built], towerCards: [...p.towerCards], flags: { ...p.flags } }));
  const kept = [...s.kept];
  const archive = [...s.archive];
  const log = [...s.log];
  const builtNow: { seat: number; card: Card; free: boolean }[] = [];
  const stagesNow: number[] = [];

  for (const seat of actingSeats(s)) {
    const p = players[seat];
    const a = p.pending!;
    const card = bonus ? kept[seat]! : p.hand.find((c) => c.uid === a.cardUid)!;
    if (bonus) kept[seat] = null;
    else p.hand = p.hand.filter((c) => c.uid !== a.cardUid);
    const name = cardDef(card.defId).name;
    if (a.type === 'sell') {
      archive.push(card);
      coins[seat] += 3;
      log.push({ term: s.term, turn: s.turn, seat, text: `sold ${name}` });
    } else if (a.type === 'chronoKeep') {
      kept[seat] = card;
      p.flags.chronoUsed = 1;
      log.push({ term: s.term, turn: s.turn, seat, text: 'kept a card for next term' });
    } else {
      const pl = a.payment;
      coins[seat] -= paid(pl);
      const left = leftOf(before, seat);
      const right = rightOf(before, seat);
      coins[left] += pl.coinsToLeft + (pl.coinsToLeft > 0 && hasPower(before, left, 'hydroTradeBonus') ? 1 : 0);
      coins[right] += pl.coinsToRight + (pl.coinsToRight > 0 && hasPower(before, right, 'hydroTradeBonus') ? 1 : 0);
      if (a.type === 'build') {
        p.built.push(card);
        builtNow.push({ seat, card, free: pl.free });
        log.push({ term: s.term, turn: s.turn, seat, text: `built ${name}` });
      } else {
        p.towerCards.push(card);
        p.towerStages += 1;
        stagesNow.push(seat);
        log.push({ term: s.term, turn: s.turn, seat, text: `raised tower stage ${p.towerStages}` });
      }
    }
    p.pending = undefined;
  }

  let next: GameState = { ...s, players: players.map((p, i) => ({ ...p, coins: coins[i] })), kept, archive, log };

  // Immediate coin effects of cards built this turn (counted after all placements).
  const extra = next.players.map(() => 0);
  for (const b of builtNow) {
    for (const e of cardDef(b.card.defId).effects) {
      if (e.kind === 'coins') extra[b.seat] += e.amount;
      if (e.kind === 'coinsPer') extra[b.seat] += e.per * scopeCount(next, b.seat, e.what, e.scope);
    }
    if (b.free && hasPower(next, b.seat, 'runeChainCoins')) extra[b.seat] += 2;
  }
  next = { ...next, players: next.players.map((p, i) => ({ ...p, coins: p.coins + extra[i] })) };
  for (const seat of stagesNow) {
    const p = next.players[seat];
    next = applyPowerOnBuild(next, seat, academyDef(p.academyId).sides[p.side][p.towerStages - 1].power);
  }

  if (bonus) return { ...next, phase: 'picking' };
  return advance(next);
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
  // End of term: archive the last card, duels, then next term or game end.
  const archive = [...s.archive, ...s.players.flatMap((p) => p.hand)];
  let next: GameState = { ...s, archive, players: s.players.map((p) => ({ ...p, hand: [] })) };
  next = resolveDuels(next, s.term);
  if (s.term === 3) return { ...next, phase: 'ended' };
  next = dealTerm(next, (s.term + 1) as Term);
  return next.kept.some((k) => k) ? { ...next, phase: 'bonus' } : { ...next, phase: 'picking' };
}
