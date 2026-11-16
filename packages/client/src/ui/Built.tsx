import { cardDef, type Card, type Family, type PublicPlayer } from '@arcane/engine';
import { useT } from './context';
import { FAMILIES, FamilyIcon } from './Family';

/**
 * One player's built cards as a compact, sideways-scrolling row, grouped by family (with a count when a family has many).
 * Every card is a button that opens the card-info sheet.
 */
export function BuiltRow(props: {
  player: PublicPlayer;
  name: string;
  onInfo(defId: string): void;
  fresh?: ReadonlySet<string>;
  className?: string;
}) {
  const t = useT();
  const { player: p } = props;
  if (p.built.length === 0) return null;
  const groups = new Map<Family, Card[]>();
  for (const c of p.built) {
    const fam = cardDef(c.defId).family;
    groups.set(fam, [...(groups.get(fam) ?? []), c]);
  }
  return (
    <ul className={`built-row${props.className ? ` ${props.className}` : ''}`} aria-label={t('builtOf', { name: props.name })}>
      {FAMILIES.filter((f) => groups.has(f)).map((fam) => {
        const cards = groups.get(fam)!;
        return (
          <li key={fam} className={`built-group fam-${fam}`}>
            {cards.length >= 3 && (
              <span className="built-count num" aria-hidden="true">
                {`×${cards.length}`}
              </span>
            )}
            {cards.map((c) => {
              const d = cardDef(c.defId);
              return (
                <button
                  key={c.uid}
                  type="button"
                  className={props.fresh?.has(c.uid) ? 'built-chip fresh' : 'built-chip'}
                  data-uid={c.uid}
                  aria-label={t('about', { name: d.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onInfo(c.defId);
                  }}
                >
                  <FamilyIcon family={fam} />
                  <span className="built-name">{d.name}</span>
                </button>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}
