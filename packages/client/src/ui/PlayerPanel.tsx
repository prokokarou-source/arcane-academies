import { academyDef, cardDef, type PublicPlayer } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';
import { duelPowerOf, productionOf, researchOf, towerOf, towerStagesOf } from '../game/derive';
import { useT } from './context';
import { CostView, EffectsView, EffectView, ResearchView } from './Glyphs';
import { academyArt, Crest } from './Icon';
import { FAMILIES as ORDER, FamilyIcon } from './Family';

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
        <img className="academy-art" src={academyArt(p.academyId)} alt="" />
        <header className="sheet-head">
          <Crest academyId={p.academyId} size={44} />
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
          <dd>
            <ResearchView counts={research} />
          </dd>
          <dt>{t('production')}</dt>
          <dd className="effects-row">
            {productionOf(p).map((x, i) => (
              <EffectView key={i} effect={{ kind: 'produce', ...x }} />
            ))}
          </dd>
        </dl>
        <h4>{t('tower')}</h4>
        <ol className="levels">
          {towerStagesOf(p).map((st, i) => (
            <li key={i} className={st.built ? 'done' : ''}>
              <div className="level-top">
                <strong>{t('towerLevel', { n: i + 1 })}</strong>
                {st.built && <span className="tag">{`✓ ${t('built')}`}</span>}
                <span className="level-cost">
                  <CostView cost={st.cost} />
                </span>
              </div>
              {st.effects.length > 0 && <EffectsView effects={st.effects} />}
              {st.power && <span className="muted small">{t(`power_${st.power}`)}</span>}
            </li>
          ))}
        </ol>
        <h4>{t('built')}</h4>
        {built.length === 0 ? (
          <p className="muted small">{t('noCards')}</p>
        ) : (
          <ul className="chips">
            {built.map((c) => {
              const d = cardDef(c.defId);
              return (
                <li key={c.uid} className={`chip fam-${d.family}`} data-family={d.family}>
                  <FamilyIcon family={d.family} label={t(`fam_${d.family}`)} />
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
