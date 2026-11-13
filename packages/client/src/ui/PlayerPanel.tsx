import { academyDef, cardDef, type Family, type PublicPlayer } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';
import { duelPowerOf, productionOf, researchOf, towerOf } from '../game/derive';
import { useT } from './context';
import { DISCIPLINE_ICON, effectLabel, FAMILY_COLOR } from './icons';

const ORDER: Family[] = ['basic', 'rare', 'lore', 'trade', 'duel', 'research', 'patron'];

/** A bottom sheet with one academy's public state. */
export function PlayerPanel(props: { player: PublicPlayer; status?: SeatStatus; onClose(): void }) {
  const t = useT();
  const p = props.player;
  const name = props.status?.name ?? p.config.name;
  const tower = towerOf(p);
  const research = researchOf(p);
  const built = [...p.built].sort((a, b) => ORDER.indexOf(cardDef(a.defId).family) - ORDER.indexOf(cardDef(b.defId).family));
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <section className="sheet" role="dialog" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h3>{name}</h3>
          <span className="muted small">{`${academyDef(p.academyId).name} · ${t('side')} ${p.side}`}</span>
        </header>
        <dl className="stats">
          <dt>{t('coins')}</dt>
          <dd>{p.coins}</dd>
          <dt>{t('duelPower')}</dt>
          <dd>{duelPowerOf(p)}</dd>
          <dt>{t('tower')}</dt>
          <dd>{t('stageOf', { built: tower.built, total: tower.total })}</dd>
          <dt>{t('research')}</dt>
          <dd>{Object.entries(research).map(([d, n]) => `${DISCIPLINE_ICON[d as keyof typeof research]}${n}`).join(' ')}</dd>
          <dt>{t('production')}</dt>
          <dd>{productionOf(p).map((x) => effectLabel({ kind: 'produce', ...x })).join('  ')}</dd>
        </dl>
        <h4>{t('built')}</h4>
        {built.length === 0 ? (
          <p className="muted small">{t('noCards')}</p>
        ) : (
          <ul className="chips">
            {built.map((c) => {
              const d = cardDef(c.defId);
              return (
                <li key={c.uid} className={`chip fam-${d.family}`} style={{ borderColor: FAMILY_COLOR[d.family] }}>
                  {d.name}
                </li>
              );
            })}
          </ul>
        )}
        <button onClick={props.onClose}>{t('close')}</button>
      </section>
    </div>
  );
}
