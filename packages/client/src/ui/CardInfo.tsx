import { describeCard } from '../game/describe';
import { useT } from './context';
import { FamilyBadge } from './Family';
import { CostView, EffectsView } from './Glyphs';
import { cardDef } from '@arcane/engine';

/** A bottom sheet that explains one card in words. */
export function CardInfo({ defId, onClose }: { defId: string; onClose(): void }) {
  const t = useT();
  const d = describeCard(defId, t);
  const def = cardDef(defId);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className={`sheet card-info-sheet fam-${def.family}`} role="dialog" aria-label={d.name} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <FamilyBadge family={def.family} />
          <h3>{d.name}</h3>
          <span className="muted small">{d.family}</span>
        </header>
        <p className="icons-line">
          <CostView cost={def.cost} />
          <span className="arrow">→</span>
          <EffectsView effects={def.effects} />
        </p>
        <p>{d.cost}</p>
        <ul className="effects">
          {d.effects.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {d.chainFrom && <p className="muted small">{d.chainFrom}</p>}
        {d.unlocks && <p className="muted small">{d.unlocks}</p>}
        <button onClick={onClose}>{t('close')}</button>
      </section>
    </div>
  );
}
