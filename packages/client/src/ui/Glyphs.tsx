/** Costs and effects drawn with icons. Text descriptions live in game/describe.ts. */
import type { Cost, CountTarget, Effect, Resource } from '@arcane/engine';
import { useT } from './context';
import { Icon } from './Icon';

const Many = ({ name, n }: { name: Resource; n: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <Icon key={i} name={name} />
    ))}
  </>
);

export function CostView({ cost }: { cost: Cost }) {
  const t = useT();
  const res = Object.entries(cost.resources ?? {}) as [Resource, number][];
  if (!cost.coins && res.length === 0) return <span className="glyphs free">{t('freeShort')}</span>;
  return (
    <span className="glyphs">
      {cost.coins ? (
        <span className="num">
          {cost.coins}
          <Icon name="coin" />
        </span>
      ) : null}
      {res.map(([r, n]) => (
        <Many key={r} name={r} n={n} />
      ))}
    </span>
  );
}

const Swatch = ({ what }: { what: CountTarget }) =>
  what === 'towerStage' ? <span className="swatch tower">♜</span> : <span className={`swatch fam-${what}`} />;

const Scope = ({ scope }: { scope: 'self' | 'neighbors' | 'selfAndNeighbors' }) =>
  scope === 'self' ? null : <span className="scope">{scope === 'neighbors' ? '◂ ▸' : '◂●▸'}</span>;

export function EffectView({ effect: e }: { effect: Effect }) {
  const t = useT();
  switch (e.kind) {
    case 'produce':
      return (
        <span className="glyphs">
          {e.options.map((r, i) => (
            <span key={r} className="opt">
              {i > 0 && <span className="slash">/</span>}
              <Icon name={r} />
            </span>
          ))}
          {e.amount > 1 && <span className="num">×{e.amount}</span>}
        </span>
      );
    case 'renown':
      return (
        <span className="glyphs num">
          +{e.amount}
          <Icon name="renown" />
        </span>
      );
    case 'duel':
      return (
        <span className="glyphs num">
          {e.amount}
          <Icon name="duel" />
        </span>
      );
    case 'research':
      return <Icon name={e.discipline} />;
    case 'coins':
      return (
        <span className="glyphs num">
          +{e.amount}
          <Icon name="coin" />
        </span>
      );
    case 'tradeDiscount':
      return (
        <span className="glyphs num">
          1<Icon name="coin" />
          <span className="tag-mini">{t(`group_${e.group}`)}</span>
          <span className="scope">{e.sides.length > 1 ? '◂ ▸' : e.sides[0] === 'left' ? '◂' : '▸'}</span>
        </span>
      );
    case 'coinsPer':
    case 'renownPer':
      return (
        <span className="glyphs num">
          {e.per}
          <Icon name={e.kind === 'coinsPer' ? 'coin' : 'renown'} />/<Swatch what={e.what} />
          <Scope scope={e.scope} />
        </span>
      );
  }
}

export function EffectsView({ effects }: { effects: Effect[] }) {
  return (
    <span className="effects-row">
      {effects.map((e, i) => (
        <EffectView key={i} effect={e} />
      ))}
    </span>
  );
}

export function ResearchView({ counts }: { counts: Record<'alchemy' | 'astronomy' | 'runes', number> }) {
  return (
    <span className="glyphs">
      {(Object.keys(counts) as (keyof typeof counts)[]).map((d) => (
        <span key={d} className="num">
          <Icon name={d} />
          {counts[d]}
        </span>
      ))}
    </span>
  );
}
