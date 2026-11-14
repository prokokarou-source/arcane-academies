/** Simple text icons (family colours and glyphs live in Family.tsx). All original. */
import type { Cost, CountTarget, Discipline, Effect, Resource } from '@arcane/engine';

export const RESOURCE_ICON: Record<Resource, string> = {
  herbs: '🌿',
  ore: '⛏️',
  ink: '✒️',
  moonstone: '🌙',
  essence: '✨',
  starglass: '🔮',
  dragonscale: '🐉',
};

export const DISCIPLINE_ICON: Record<Discipline, string> = { alchemy: '⚗️', astronomy: '🔭', runes: '📜' };
const TARGET_ICON: Record<CountTarget, string> = {
  basic: '🟫',
  rare: '⬜',
  lore: '🟦',
  trade: '🟨',
  duel: '🟥',
  research: '🟩',
  patron: '🟪',
  towerStage: '🗼',
};
export const COIN = '🪙';
export const RENOWN = '★';
export const DUEL = '⚔️';

export function costLabel(c: Cost): string {
  const parts: string[] = [];
  if (c.coins) parts.push(`${c.coins}${COIN}`);
  for (const [r, n] of Object.entries(c.resources ?? {})) parts.push(RESOURCE_ICON[r as Resource].repeat(n ?? 0));
  return parts.join(' ') || '—';
}

export function effectLabel(e: Effect): string {
  switch (e.kind) {
    case 'produce':
      return e.options.map((r) => RESOURCE_ICON[r]).join('/') + (e.amount > 1 ? ` ×${e.amount}` : '');
    case 'renown':
      return `+${e.amount} ${RENOWN}`;
    case 'duel':
      return `${DUEL} ${e.amount}`;
    case 'research':
      return DISCIPLINE_ICON[e.discipline];
    case 'coins':
      return `+${e.amount} ${COIN}`;
    case 'tradeDiscount':
      return `1${COIN} ${e.group === 'basic' ? '🟫' : '⬜'} ${e.sides.map((s) => (s === 'left' ? '◀' : '▶')).join('')}`;
    case 'coinsPer':
      return `${e.per}${COIN}/${TARGET_ICON[e.what]}`;
    case 'renownPer':
      return `${e.per}${RENOWN}/${TARGET_ICON[e.what]}${e.scope === 'self' ? '' : e.scope === 'neighbors' ? ' ◀▶' : ' ◀●▶'}`;
  }
}
