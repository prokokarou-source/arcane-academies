/**
 * Original placeholder art: small SVG glyphs for resources, disciplines, coins, renown and duels,
 * plus one crest per academy. Each glyph is an accessible image named in the current language.
 */
import type { Discipline, Resource } from '@arcane/engine';
import { useT } from './context';

export type IconName = Resource | Discipline | 'coin' | 'renown' | 'duel';

const PATHS: Record<IconName, { color: string; body: JSX.Element }> = {
  herbs: { color: '#4f9a4a', body: <path d="M12 21c0-6 2-10 7-14-1 6-3 9-7 10m0 4c0-5-2-8-6-10 0 5 2 8 6 10" /> },
  ore: { color: '#7d8494', body: <path d="M4 16l4-8 6-2 6 5-2 8-9 1z M8 8l3 6 9-3 M11 14l-2 6" /> },
  ink: { color: '#2f4fa8', body: <path d="M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" /> },
  moonstone: { color: '#7f9bd6', body: <path d="M15 3a9 9 0 1 0 6 13A7 7 0 0 1 15 3z" /> },
  essence: { color: '#c35fcb', body: <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" /> },
  starglass: { color: '#2fa9c4', body: <path d="M12 2l7 6-7 14-7-14z M5 8h14 M9 8l3 14 3-14" /> },
  dragonscale: { color: '#c2453c', body: <path d="M4 6c4 0 8 2 8 7 0-5 4-7 8-7-1 7-4 12-8 15-4-3-7-8-8-15z" /> },
  alchemy: { color: '#b83b8f', body: <path d="M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3 M7 15h10" /> },
  astronomy: { color: '#b83b8f', body: <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M2 15c5-1 15-5 20-9" /> },
  runes: { color: '#b83b8f', body: <path d="M7 3h10l2 18H5z M10 7v10 M10 8l4 3-4 3 4 3" /> },
  coin: { color: '#d39b22', body: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7l2.5 5-2.5 5-2.5-5z" /> },
  renown: { color: '#c9962a', body: <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" /> },
  duel: { color: '#d4651c', body: <path d="M4 4l16 16 M20 4L4 20 M3 7l4-4 M17 3l4 4 M3 17l4 4 M17 21l4-4" /> },
};

const FILLED: IconName[] = ['ink', 'moonstone', 'essence', 'dragonscale', 'renown'];

export function Icon({ name, size = '1.15em' }: { name: IconName; size?: string }) {
  const t = useT();
  const { color, body } = PATHS[name];
  const label =
    name === 'coin' ? t('coins') : name === 'renown' ? t('renownName') : name === 'duel' ? t('duelPower') : name in DISC ? t(`disc_${name as Discipline}`) : t(`res_${name as Resource}`);
  const filled = FILLED.includes(name);
  return (
    <svg
      className={`icon icon-${name}`}
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? color : 'none'}
      stroke={filled ? 'rgba(0,0,0,.35)' : color}
      strokeWidth={filled ? 1 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{label}</title>
      {body}
    </svg>
  );
}

const DISC = { alchemy: 1, astronomy: 1, runes: 1 };

/** One crest per academy, drawn from its element. */
const CRESTS: Record<string, { color: string; body: JSX.Element }> = {
  pyromancy: { color: '#e0662a', body: <path d="M16 6c3 5 7 8 7 14a7 7 0 0 1-14 0c0-3 2-5 3-7 0 3 1 4 2 4 0-4-1-7 2-11z" /> },
  hydromancy: { color: '#3d8fd6', body: <path d="M5 18c3-3 5-3 8 0s5 3 8 0 5-3 6 0 M5 12c3-3 5-3 8 0s5 3 8 0 5-3 6 0" /> },
  verdant: { color: '#4f9a4a', body: <path d="M16 27V12 M16 14c-6 0-9-4-9-9 6 0 9 4 9 9z M16 18c6 0 9-4 9-9-6 0-9 4-9 9z" /> },
  shadow: { color: '#6b4fb8', body: <path d="M4 16s5-8 12-8 12 8 12 8-5 8-12 8S4 16 4 16z M16 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /> },
  astral: { color: '#2fa9c4', body: <path d="M16 4l3 9h9l-7 5 3 9-8-6-8 6 3-9-7-5h9z" /> },
  chronomancy: { color: '#c35fcb', body: <path d="M9 4h14 M9 28h14 M10 4c0 7 12 7 12 12S10 21 10 28 M22 4c0 7-12 7-12 12s12 5 12 12" /> },
  runeforge: { color: '#c2453c', body: <path d="M6 22h20l-3 5H9z M10 22V12l6-6 6 6v10 M16 9v10 M13 13l3 3 3-3" /> },
};

/** Painted art of an academy (in public/academies/), used where there is room for it. */
export function academyArt(academyId: string): string {
  return `/academies/${CRESTS[academyId] ? academyId : 'astral'}.webp`;
}

export function Crest({ academyId, size = 40 }: { academyId: string; size?: number }) {
  const c = CRESTS[academyId] ?? CRESTS.astral;
  return (
    <svg className="crest" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" style={{ ['--crest' as string]: c.color }}>
      <path className="crest-shield" d="M16 1l13 4v10c0 8-6 13-13 16C9 28 3 23 3 15V5z" />
      <g fill="none" stroke={c.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" transform="translate(4 3.5) scale(.75)">
        {c.body}
      </g>
    </svg>
  );
}
