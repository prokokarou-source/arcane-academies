/**
 * Pure helpers that turn the server's per-seat view into what the screens show.
 * They only read engine data (card and academy definitions), never server code.
 */
import { academyDef, cardDef, DISCIPLINES } from '@arcane/engine';
import type { Action, Discipline, Effect, PaymentPlan, PlayerView, PublicPlayer, Resource, TowerStage } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';

export interface CardOptions {
  cardUid: string;
  defId: string;
  build?: Action;
  tower?: Action;
  sell?: Action;
  keep?: Action;
}

const KEY: Record<Action['type'], keyof Omit<CardOptions, 'cardUid' | 'defId'>> = {
  build: 'build',
  tower: 'tower',
  sell: 'sell',
  chronoKeep: 'keep',
};

/** One entry per card I can play now (my hand, or my kept card in the bonus phase), with the legal actions for it. */
export function handOptions(view: PlayerView, legal: Action[]): CardOptions[] {
  const me = view.players[view.me];
  const cards = view.phase === 'bonus' ? (me.kept ? [me.kept] : []) : (me.hand ?? []);
  return cards.map((c) => {
    const o: CardOptions = { cardUid: c.uid, defId: c.defId };
    for (const a of legal) if (a.cardUid === c.uid) o[KEY[a.type]] = a;
    return o;
  });
}

export const tradeCost = (p: PaymentPlan): number => p.coinsToLeft + p.coinsToRight;
export const bankCost = (p: PaymentPlan): number => p.coinsToBank;

export function neighbors(view: PlayerView): { left: number; right: number } {
  const n = view.players.length;
  return { left: (view.me + n - 1) % n, right: (view.me + 1) % n };
}

function effectsOf(p: PublicPlayer): Effect[] {
  const stages = academyDef(p.academyId).sides[p.side].slice(0, p.towerStages);
  return [...p.built.flatMap((c) => cardDef(c.defId).effects), ...stages.flatMap((s) => s.effects)];
}

export function duelPowerOf(p: PublicPlayer): number {
  return effectsOf(p).reduce((sum, e) => sum + (e.kind === 'duel' ? e.amount : 0), 0);
}

export function researchOf(p: PublicPlayer): Record<Discipline, number> {
  const out = Object.fromEntries(DISCIPLINES.map((d) => [d, 0])) as Record<Discipline, number>;
  for (const e of effectsOf(p)) if (e.kind === 'research') out[e.discipline]++;
  return out;
}

export function productionOf(p: PublicPlayer): { options: Resource[]; amount: number }[] {
  const own = effectsOf(p).filter((e): e is Extract<Effect, { kind: 'produce' }> => e.kind === 'produce');
  return [{ options: [academyDef(p.academyId).home], amount: 1 }, ...own.map((e) => ({ options: e.options, amount: e.amount }))];
}

export function towerOf(p: PublicPlayer): { built: number; total: number; next?: TowerStage } {
  const stages = academyDef(p.academyId).sides[p.side];
  const next = stages[p.towerStages];
  return { built: p.towerStages, total: stages.length, ...(next ? { next } : {}) };
}

/** Duel tokens added per seat between two views, or null when no duels happened in between. */
export function termDuels(prev: PlayerView | null, next: PlayerView): { seat: number; deltas: number[] }[] | null {
  if (!prev || prev.players.length !== next.players.length) return null;
  const out = next.duelTokens.map((tokens, seat) => ({ seat, deltas: tokens.slice(prev.duelTokens[seat]?.length ?? 0) }));
  return out.some((x) => x.deltas.length > 0) ? out : null;
}

/** Names of seats still to pick this turn (Archmage excluded); null in the bonus phase, where the view can't tell who acts. */
export function waitingFor(view: PlayerView, seats: SeatStatus[]): string[] | null {
  if (view.phase === 'bonus') return null;
  if (view.phase === 'ended') return [];
  return view.players
    .filter((p) => !p.hasSubmitted && seats[p.seat]?.kind !== 'archmage')
    .map((p) => seats[p.seat]?.name ?? p.config.name);
}
