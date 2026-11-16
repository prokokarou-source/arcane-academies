/**
 * Player avatars: one of 16 emblems drawn in one of 8 theme colours.
 * Guests (and accounts that never picked) get a neutral hooded sigil.
 */
import { AVATAR_COLORS, AVATAR_ICONS, type Avatar, type AvatarColor, type AvatarIcon } from '@arcane/protocol';
import { useT } from './context';

export const AVATAR_HEX: Record<AvatarColor, string> = {
  gold: '#d9a62e',
  ember: '#e0662a',
  rose: '#d65a7e',
  violet: '#9a6fe0',
  azure: '#4b8fe0',
  teal: '#2fb0a8',
  moss: '#6fa64a',
  silver: '#a9b3c6',
};

/** Line glyphs on a 24×24 grid. */
const GLYPHS: Record<AvatarIcon | 'none', JSX.Element> = {
  owl: <path d="M5 5l3 3h8l3-3v9a7 7 0 0 1-14 0z M9.5 11.5a1.5 1.5 0 1 0 0 .1 M14.5 11.5a1.5 1.5 0 1 0 0 .1 M12 13l-1 2h2z" />,
  flame: <path d="M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 0 2 1 3 2 3 0-3-1-5 1-8z" />,
  wave: <path d="M3 15c3-3 5-3 7 0s4 3 7 0 3-2 4-1 M3 10c3-3 5-3 7 0s4 3 7 0 3-2 4-1" />,
  leaf: <path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z M5 19l9-9" />,
  star: <path d="M12 3l2.4 5.6 6 .6-4.6 4 1.4 5.9L12 16l-5.2 3.1 1.4-5.9-4.6-4 6-.6z" />,
  moon: <path d="M15 4a8 8 0 1 0 5 12 6.5 6.5 0 0 1-5-12z" />,
  key: <path d="M8 8a4 4 0 1 0 0 .1 M11 11l9 9 M16 16l2-2 M18 18l2-2" />,
  crown: <path d="M4 17l-1-9 5 4 4-6 4 6 5-4-1 9z M4 20h16" />,
  quill: <path d="M20 4C12 5 7 10 6 18l2-2c3 0 7-2 9-6l-3 0 4-2c1-1 2-3 2-4z M6 18l-2 3" />,
  eye: <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />,
  hourglass: <path d="M6 3h12 M6 21h12 M7 3c0 6 10 6 10 9s-10 3-10 9 M17 3c0 6-10 6-10 9s10 3 10 9" />,
  rune: <path d="M8 3v18 M8 6l8 4-8 4 M16 14v7" />,
  crystal: <path d="M12 2l6 7-6 13-6-13z M6 9h12 M10 9l2 13 2-13" />,
  tower: <path d="M7 21V9h10v12 M5 21h14 M7 9V5h2v2h2V5h2v2h2V5h2v4 M11 21v-4h2v4 M11 12h2" />,
  comet: <path d="M15 9a3 3 0 1 0 0 .1 M13 11L4 20 M12 8L5 15 M16 12l-7 7" />,
  mask: <path d="M4 6c5-2 11-2 16 0 0 8-3 13-8 13S4 14 4 6z M8 10l2.5 1 M16 10l-2.5 1 M9 15c2 1 4 1 6 0" />,
  none: <path d="M12 4c-4 0-6 3-6 7v9h12v-9c0-4-2-7-6-7z M9 13c1 1 5 1 6 0" />,
};

export function AvatarGlyph(props: { avatar?: Avatar | null; size?: number; label?: string }) {
  const { avatar, size = 28 } = props;
  const color = avatar ? AVATAR_HEX[avatar.color] : 'var(--muted)';
  return (
    <svg
      className={`avatar-badge${avatar ? '' : ' avatar-default'}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ ['--av' as string]: color }}
      {...(props.label ? { role: 'img', 'aria-label': props.label } : { 'aria-hidden': true })}
    >
      <circle cx="12" cy="12" r="11.5" className="avatar-ring" />
      <g fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" transform="translate(3.6 3.6) scale(.7)">
        {GLYPHS[avatar?.icon ?? 'none']}
      </g>
    </svg>
  );
}

/** Pick an emblem and a colour; `onPick(null)` goes back to the default. */
export function AvatarPicker(props: { value: Avatar | null; onPick(a: Avatar | null): void }) {
  const t = useT();
  const cur = props.value;
  const color = cur?.color ?? 'gold';
  return (
    <div className="avatar-picker">
      <div className="avatar-grid" role="radiogroup" aria-label={t('avatarEmblem')}>
        {AVATAR_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={cur?.icon === icon}
            aria-label={t(`avatar_${icon}`)}
            className={`avatar-opt${cur?.icon === icon ? ' on' : ''}`}
            onClick={() => props.onPick({ icon, color })}
          >
            <AvatarGlyph avatar={{ icon, color }} size={34} />
          </button>
        ))}
      </div>
      <div className="avatar-colors" role="radiogroup" aria-label={t('avatarColor')}>
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={cur?.color === c}
            aria-label={t(`avc_${c}`)}
            className={`avatar-swatch${cur?.color === c ? ' on' : ''}`}
            style={{ background: AVATAR_HEX[c] }}
            disabled={!cur}
            onClick={() => cur && props.onPick({ icon: cur.icon, color: c })}
          />
        ))}
      </div>
      {cur && (
        <button type="button" className="link" onClick={() => props.onPick(null)}>
          {t('avatarReset')}
        </button>
      )}
    </div>
  );
}
