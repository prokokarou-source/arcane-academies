import { cardDef } from '@arcane/engine';
import { bankCost, tradeCost, type CardOptions } from '../game/derive';
import { useT } from './context';
import { CostView, EffectsView } from './Glyphs';

export function CardView(props: { opt: CardOptions; selected: boolean; onSelect(): void; onInfo(): void }) {
  const t = useT();
  const def = cardDef(props.opt.defId);
  const b = props.opt.build;
  const plan = b && b.type === 'build' ? b.payment : null;
  let status: string;
  if (!plan) status = t('cantBuild');
  else if (plan.free) status = t('free');
  else if (tradeCost(plan) > 0) status = t('buyFor', { n: tradeCost(plan) });
  else if (bankCost(plan) > 0) status = t('costsCoins', { n: bankCost(plan) });
  else status = t('affordable');
  return (
    <div className="card-wrap">
    <button
      type="button"
      data-testid="card"
      data-uid={props.opt.cardUid}
      className={`card fam-${def.family}${props.selected ? ' selected' : ''}${plan ? '' : ' blocked'}`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <span className="card-name">{def.name}</span>
      <span className="card-cost">
        <CostView cost={def.cost} />
      </span>
      <span className="card-effects">
        <EffectsView effects={def.effects} />
      </span>
      <span className={`card-status${plan ? (plan.free ? ' ok' : '') : ' no'}`}>{status}</span>
    </button>
    <button type="button" className="card-info" aria-label={t('about', { name: def.name })} onClick={props.onInfo}>
      ⓘ
    </button>
    </div>
  );
}
