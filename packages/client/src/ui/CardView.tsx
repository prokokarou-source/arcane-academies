import { cardDef } from '@arcane/engine';
import { bankCost, tradeCost, type CardOptions } from '../game/derive';
import { useT } from './context';
import { costLabel, effectLabel } from './icons';

export function CardView(props: { opt: CardOptions; selected: boolean; onSelect(): void }) {
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
    <button
      type="button"
      data-testid="card"
      data-uid={props.opt.cardUid}
      className={`card fam-${def.family}${props.selected ? ' selected' : ''}${plan ? '' : ' blocked'}`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <span className="card-name">{def.name}</span>
      <span className="card-cost">{costLabel(def.cost)}</span>
      <span className="card-effects">{def.effects.map(effectLabel).join('  ')}</span>
      <span className={`card-status${plan ? (plan.free ? ' ok' : '') : ' no'}`}>{status}</span>
    </button>
  );
}
