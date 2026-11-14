import type { Discipline, GameState, PowerId } from './types';
import { DISCIPLINES } from './types';
import { cardDef } from './data/cards';
import { academyDef } from './data/academies';
import { hasPower } from './powers';
import { scopeCount } from './actions';

export type ScoreCategory = 'duels' | 'coins' | 'tower' | 'lore' | 'trade' | 'research' | 'patrons';

/** One source of points; `kind` says what `n` / `stage` / `power` / `defId` refer to. */
export type ScoreItem = { cat: ScoreCategory; points: number } & (
  | { kind: 'duels' }
  | { kind: 'coins'; n: number } // n = coins held at the end
  | { kind: 'stage'; stage: number } // 1-based tower stage
  | { kind: 'power'; power: PowerId }
  | { kind: 'card'; defId: string }
  | { kind: 'research' }
);

export type ScoreBreakdown = {
  seat: number;
  duels: number;
  coins: number;
  tower: number;
  lore: number;
  trade: number;
  research: number;
  patrons: number;
  total: number;
  /** Where the points came from, one entry per source worth non-zero points; they sum to `total`. */
  items: ScoreItem[];
};

/** 2 per symbol, +6 per full set (+3 more with the Astral power), +5 per discipline with 3+ symbols. */
export function scoreResearch(counts: Record<Discipline, number>, astralBonus: boolean): number {
  const values = DISCIPLINES.map((d) => counts[d] ?? 0);
  const symbols = values.reduce((a, b) => a + b, 0);
  const sets = Math.min(...values);
  const deep = values.filter((v) => v >= 3).length;
  return 2 * symbols + sets * (6 + (astralBonus ? 3 : 0)) + 5 * deep;
}

export function finalScores(s: GameState): ScoreBreakdown[] {
  return s.players.map((p) => {
    const seat = p.seat;
    const b: ScoreBreakdown = { seat, duels: 0, coins: 0, tower: 0, lore: 0, trade: 0, research: 0, patrons: 0, total: 0, items: [] };
    const add = (item: ScoreItem) => {
      if (item.points === 0) return;
      b[item.cat] += item.points;
      b.items.push(item);
    };
    add({ cat: 'duels', kind: 'duels', points: s.duelTokens[seat].reduce((a, x) => a + x, 0) });
    add({ cat: 'coins', kind: 'coins', n: p.coins, points: Math.floor(p.coins / 3) });
    academyDef(p.academyId)
      .sides[p.side].slice(0, p.towerStages)
      .forEach((st, i) => {
        let v = 0;
        for (const e of st.effects) if (e.kind === 'renown') v += e.amount;
        add({ cat: 'tower', kind: 'stage', stage: i + 1, points: v });
      });
    if (hasPower(s, seat, 'verdantWhiteRenown')) {
      add({ cat: 'tower', kind: 'power', power: 'verdantWhiteRenown', points: scopeCount(s, seat, 'basic', 'self') });
    }
    const counts: Record<Discipline, number> = { alchemy: 0, astronomy: 0, runes: 0 };
    for (const c of p.built) {
      const def = cardDef(c.defId);
      let v = 0;
      for (const e of def.effects) {
        if (e.kind === 'renown') v += e.amount;
        if (e.kind === 'renownPer') v += e.per * scopeCount(s, seat, e.what, e.scope);
        if (e.kind === 'research') counts[e.discipline]++;
      }
      const cat = def.family === 'lore' ? 'lore' : def.family === 'trade' ? 'trade' : def.family === 'patron' ? 'patrons' : null;
      if (cat) add({ cat, kind: 'card', defId: def.id, points: v });
    }
    add({ cat: 'research', kind: 'research', points: scoreResearch(counts, hasPower(s, seat, 'astralSetBonus')) });
    b.total = b.duels + b.coins + b.tower + b.lore + b.trade + b.research + b.patrons;
    return b;
  });
}

/** Winning seats (never the Rival Archmage): highest total, then most coins; remaining ties share the win. */
export function winners(s: GameState): number[] {
  const scores = finalScores(s).filter((b) => s.players[b.seat].config.kind !== 'archmage');
  const best = Math.max(...scores.map((b) => b.total));
  const top = scores.filter((b) => b.total === best);
  const maxCoins = Math.max(...top.map((b) => s.players[b.seat].coins));
  return top.filter((b) => s.players[b.seat].coins === maxCoins).map((b) => b.seat);
}
