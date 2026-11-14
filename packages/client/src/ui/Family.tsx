/**
 * Card families: one colour, one original glyph and one short label each, so families read at a glance
 * on a phone and never rely on colour alone. Colours are tuned to stay readable on the night-indigo UI.
 */
import type { Family, PublicPlayer } from '@arcane/engine';
import { cardDef } from '@arcane/engine';
import { useT } from './context';

export const FAMILIES: Family[] = ['basic', 'rare', 'lore', 'trade', 'duel', 'research', 'patron'];

/** Keep in sync with the .fam-* rules in styles.css. */
export const FAMILY_COLOR: Record<Family, string> = {
  basic: '#b07a43', // brown: raw materials
  rare: '#dfe4ec', // silver-white: rare materials
  lore: '#5b9cf0', // blue
  trade: '#f2c230', // yellow
  duel: '#e8503f', // red
  research: '#4fb865', // green
  patron: '#ae78ea', // purple
};

const GLYPH: Record<Family, JSX.Element> = {
  // stacked bricks
  basic: <path d="M3 8h18v12H3z M3 14h18 M9 8v6 M15 14v6 M6 8V4h12v4 M12 4v4" />,
  // crystal cluster
  rare: <path d="M8 21l-4-9 4-8 4 8z M14 21l-2-7 4-10 4 10-2 7z" />,
  // open book
  lore: <path d="M12 6C10 4 6 4 3 5v14c3-1 7-1 9 1 2-2 6-2 9-1V5c-3-1-7-1-9 1z M12 6v14" />,
  // balance scales
  trade: <path d="M12 3v17 M7 20h10 M4 7h16 M4 7l-3 7h6z M20 7l-3 7h6z" />,
  // lightning bolt
  duel: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  // magnifying lens
  research: <path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M15 15l6 6" />,
  // crown
  patron: <path d="M3 20h18 M4 16L2 7l6 4 4-7 4 7 6-4-2 9z" />,
};

/** A family glyph drawn in the current colour. Decorative unless `label` is given. */
export function FamilyIcon({ family, size = '1em', label }: { family: Family; size?: string; label?: string }) {
  return (
    <svg
      className="fam-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {GLYPH[family]}
    </svg>
  );
}

/** A dark pill with the family glyph and its short name. */
export function FamilyBadge({ family }: { family: Family }) {
  const t = useT();
  return (
    <span className={`fam-badge fam-${family}`} data-family={family}>
      <FamilyIcon family={family} />
      <span>{t(`fam_${family}`)}</span>
    </span>
  );
}

/** How many cards of each family a player has built, as glyph + count (families with none are left out). */
export function FamilyCounts({ player }: { player: PublicPlayer }) {
  const t = useT();
  const counts = new Map<Family, number>();
  for (const c of player.built) {
    const f = cardDef(c.defId).family;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const shown = FAMILIES.filter((f) => counts.has(f));
  if (shown.length === 0) return null;
  return (
    <span className="fam-counts">
      {shown.map((f) => (
        <span key={f} className={`fam-count fam-${f}`}>
          <FamilyIcon family={f} label={t(`fam_${f}`)} />
          {counts.get(f)}
        </span>
      ))}
    </span>
  );
}
