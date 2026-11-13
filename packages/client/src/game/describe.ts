/** Plain-language description of a card, built from its data so it never drifts from the rules. */
import { cardDef, CARDS, PATRONS } from '@arcane/engine';
import type { Cost, Effect, Resource } from '@arcane/engine';
import type { StringKey } from '../i18n/strings';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export interface CardDescription {
  name: string;
  family: string;
  cost: string;
  effects: string[];
  chainFrom?: string;
  unlocks?: string;
}

const BASIC: Resource[] = ['herbs', 'ore', 'ink', 'moonstone'];
const RARE: Resource[] = ['essence', 'starglass', 'dragonscale'];

const orList = (t: T, items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${t('or')} ${items[items.length - 1]}`;

function costText(t: T, c: Cost): string {
  const items: string[] = [];
  if (c.coins) items.push(c.coins === 1 ? t('oneCoin') : t('nCoins', { n: c.coins }));
  for (const [r, n] of Object.entries(c.resources ?? {})) items.push(`${n} ${t(`res_${r as Resource}`)}`);
  return items.length ? t('costIs', { items: items.join(', ') }) : t('costFree');
}

function effectText(t: T, e: Effect): string {
  switch (e.kind) {
    case 'produce':
      return e.options.length > 1
        ? t('eff_produceChoice', { n: e.amount, list: orList(t, e.options.map((r) => t(`res_${r}`))) })
        : t('eff_produce', { n: e.amount, res: t(`res_${e.options[0]}`) });
    case 'renown':
      return t('eff_renown', { n: e.amount });
    case 'duel':
      return t('eff_duel', { n: e.amount });
    case 'research':
      return t('eff_research', { d: t(`disc_${e.discipline}`) });
    case 'coins':
      return t('eff_coins', { n: e.amount });
    case 'tradeDiscount': {
      const list = (e.group === 'basic' ? BASIC : RARE).map((r) => t(`res_${r}`)).join(', ');
      const sides = e.sides.length > 1 ? t('sides_both') : t(`sides_${e.sides[0]}`);
      return t('eff_tradeDiscount', { group: t(`group_${e.group}`), list, sides });
    }
    case 'coinsPer':
      return t('eff_coinsPer', { n: e.per, what: t(`what_${e.what}`), scope: t(`scope_${e.scope}`) });
    case 'renownPer':
      return t('eff_renownPer', { n: e.per, what: t(`what_${e.what}`), scope: t(`scope_${e.scope}`) });
  }
}

export function describeCard(defId: string, t: T): CardDescription {
  const def = cardDef(defId);
  const unlocks = [...new Set([...CARDS, ...PATRONS].filter((c) => c.chainFrom?.includes(def.name)).map((c) => c.name))];
  return {
    name: def.name,
    family: t(`family_${def.family}`),
    cost: costText(t, def.cost),
    effects: def.effects.map((e) => effectText(t, e)),
    ...(def.chainFrom?.length ? { chainFrom: t('chainFrom', { names: orList(t, def.chainFrom) }) } : {}),
    ...(unlocks.length ? { unlocks: t('unlocks', { names: unlocks.join(', ') }) } : {}),
  };
}
