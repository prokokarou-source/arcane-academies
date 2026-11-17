/**
 * The phone menu's frame: identity header with the bell, segmented controls, and the 4-slot bottom bar.
 * Icons are original line glyphs on a 24×24 grid.
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BotLevel } from '@arcane/engine';
import { useSound } from '../audio/context';
import type { Division } from '../net/menuTypes';
import { AvatarGlyph } from './Avatar';
import { useClient, useClientState, usePrefs, useT } from './context';

export const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

export type Tab = 'boards' | 'rooms' | 'play' | 'more';

const GLYPH: Record<string, JSX.Element> = {
  boards: <path d="M4 20V13h5v7 M9 20V8h6v12 M15 20v-9h5v9 M3 20h18 M12 3l1 2 2 .3-1.5 1.4.4 2.1L12 7.8l-1.9 1 .4-2.1L9 5.3l2-.3z" />,
  rooms: <path d="M5 21V9a7 7 0 0 1 14 0v12 M3 21h18 M9 21v-7a3 3 0 0 1 6 0v7 M12 5v2" />,
  play: <path d="M5 19L15 9 M13 7l4 4 M17 3l.8 2.2L20 6l-2.2.8L17 9l-.8-2.2L14 6l2.2-.8z M5 11l.6 1.4L7 13l-1.4.6L5 15l-.6-1.4L3 13l1.4-.6z" />,
  more: <path d="M4 7h16 M4 12h16 M4 17h16" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0" />,
  bots: <path d="M7 9h10v9H7z M12 5v4 M10 13h.01 M14 13h.01 M10 16h4 M4 12v3 M20 12v3 M12 4.5a.5.5 0 1 0 0 .1" />,
  casual: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3 2-6 5-6s5 3 5 6 M11 20c0-3 2-6 5-6s5 3 5 6" />,
  ranked: <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z M12 8l1.3 2.6 2.7.4-2 1.9.5 2.7L12 14.3l-2.5 1.3.5-2.7-2-1.9 2.7-.4z" />,
  clock: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v4l3 2" />,
  person: <path d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M5 20c0-4 3-7 7-7s7 3 7 7" />,
  search: <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.5 15.5L20 20" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  external: <path d="M14 4h6v6 M20 4l-9 9 M18 14v5H5V6h5" />,
  open: <path d="M4 6h16v12H4z M4 10h16 M8 14h3" />,
  eye: <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />,
};

export function Glyph({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {GLYPH[name]}
    </svg>
  );
}

/** Original division badges: candle, crossed wands, star tome, crowned star. */
const DIV: Record<Division, { color: string; body: JSX.Element }> = {
  apprentice: { color: '#c08850', body: <path d="M10 10h4v9h-4z M12 10c-1.5-1.5-1.5-3 0-5 1.5 2 1.5 3.5 0 5z M8 19h8" /> },
  adept: { color: '#c9d1e0', body: <path d="M5 19L17 7 M19 19L7 7 M16 5l3 3 M8 5L5 8 M17 5.5l1.5 1.5 M7 5.5L5.5 7" /> },
  magister: { color: '#e8b54a', body: <path d="M4 7c3-1 6-1 8 1 2-2 5-2 8-1v11c-3-1-6-1-8 1-2-2-5-2-8-1z M12 8v11 M8 10.5l.6 1.2 1.3.2-1 .9.3 1.3L8 13.5l-1.2.6.3-1.3-1-.9 1.3-.2z" /> },
  archmage: { color: '#b48cff', body: <path d="M5 9l3 2 4-5 4 5 3-2-1.5 5h-11z M12 15l1.2 2.4 2.6.3-1.9 1.8.5 2.5-2.4-1.3-2.4 1.3.5-2.5-1.9-1.8 2.6-.3z" /> },
};

export function DivisionBadge({ division, size = 26 }: { division: Division; size?: number }) {
  const t = useT();
  const d = DIV[division];
  const label = t(`div_${division}`);
  return (
    <svg className={`division div-${division}`} viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={label} style={{ ['--div' as string]: d.color }}>
      <title>{label}</title>
      <path className="division-ring" d="M12 1.5l9 3.5v7c0 6-4 9.5-9 11.5-5-2-9-5.5-9-11.5V5z" />
      <g fill="none" stroke={d.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" transform="translate(3.6 3.4) scale(.7)">
        {d.body}
      </g>
    </svg>
  );
}

/** A country's flag as emoji (with its name for screen readers). */
export function Flag({ country }: { country: string | null | undefined }) {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return null;
  const code = country.toUpperCase();
  const emoji = String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  return (
    <span className="flag" role="img" aria-label={countryName(code)} title={countryName(code)}>
      {emoji}
    </span>
  );
}

let names: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** A row of mutually exclusive options (tabs or a setting). */
export function Segmented<V extends string | number>(props: {
  label: string;
  value: V;
  options: { value: V; label: string; icon?: string; disabled?: boolean }[];
  onChange(v: V): void;
  kind?: 'tabs' | 'choice';
  className?: string;
}) {
  const sound = useSound();
  const tabs = props.kind === 'tabs';
  return (
    <div className={`segmented ${props.className ?? ''}`} role={tabs ? 'tablist' : 'radiogroup'} aria-label={props.label}>
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role={tabs ? 'tab' : 'radio'}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            disabled={o.disabled}
            className={on ? 'on' : ''}
            onClick={() => {
              sound('tap');
              props.onChange(o.value);
            }}
          >
            {o.icon && <Glyph name={o.icon} size={18} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** − n + for a small whole number. */
export function Stepper(props: { label: string; value: number; min: number; max: number; onChange(n: number): void }) {
  const t = useT();
  return (
    <div className="stepper" role="group" aria-label={props.label}>
      <button type="button" aria-label={t('decrease', { what: props.label })} disabled={props.value <= props.min} onClick={() => props.onChange(props.value - 1)}>
        −
      </button>
      <output aria-live="polite">{props.value}</output>
      <button type="button" aria-label={t('increase', { what: props.label })} disabled={props.value >= props.max} onClick={() => props.onChange(props.value + 1)}>
        +
      </button>
    </div>
  );
}

/** Avatar and name (or Guest + Log in) on the left; the bell with friend requests and invites on the right. */
export function MenuHeader(props: { onLogin(): void; onProfile(): void; onFriends(): void }) {
  const t = useT();
  const { account, avatar } = useClientState();
  return (
    <header className="menu-head">
      {account ? (
        <button className="who" onClick={props.onProfile} aria-label={t('openProfile')}>
          <AvatarGlyph avatar={avatar} size={40} />
          <strong className="name">{account}</strong>
        </button>
      ) : (
        <div className="who">
          <AvatarGlyph avatar={null} size={40} />
          <strong className="name">{t('guest')}</strong>
          <button className="primary login" onClick={props.onLogin}>
            {t('logIn')}
          </button>
        </div>
      )}
      <Bell onFriends={props.onFriends} />
    </header>
  );
}

/** The bell: friend requests and room invites, with a count badge. */
export function Bell(props: { onFriends(): void }) {
  const t = useT();
  const { friends, invites } = useClientState();
  const [bell, setBell] = useState(false);
  const count = (friends?.incoming.length ?? 0) + invites.length;
  return (
    <>
      <button className="bell" aria-label={count ? t('notificationsN', { n: count }) : t('notifications')} onClick={() => setBell(true)}>
        <Glyph name="bell" size={24} />
        {count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {bell && <BellSheet onClose={() => setBell(false)} onFriends={props.onFriends} />}
    </>
  );
}

function BellSheet(props: { onClose(): void; onFriends(): void }) {
  const t = useT();
  const client = useClient();
  const [prefs] = usePrefs();
  const { account, friends, invites } = useClientState();
  const incoming = friends?.incoming ?? [];
  return createPortal(
    <div className="sheet-backdrop" onClick={props.onClose}>
      <section className="sheet bell-sheet" role="dialog" aria-label={t('notifications')} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h3>{t('notifications')}</h3>
        </header>
        {invites.length === 0 && incoming.length === 0 && <p className="empty">{t('nothingNew')}</p>}
        {invites.map((inv) => (
          <div key={`${inv.from}/${inv.code}`} className="note-row">
            <span>{t('inviteFrom', { name: inv.from, code: inv.code })}</span>
            <span className="row">
              <button
                className="primary"
                onClick={() => {
                  props.onClose();
                  client.acceptInvite(inv, account ?? (prefs.name.trim() || inv.code));
                }}
              >
                {t('join')}
              </button>
              <button className="link" onClick={() => client.dismissInvite(inv)}>
                {t('dismiss')}
              </button>
            </span>
          </div>
        ))}
        {incoming.map((u) => (
          <div key={u} className="note-row">
            <span>{t('friendRequestFrom', { name: u })}</span>
            <span className="row">
              <button className="primary" onClick={() => client.acceptFriend(u)}>
                {t('accept')}
              </button>
              <button className="link danger" onClick={() => client.removeFriend(u)}>
                {t('decline')}
              </button>
            </span>
          </div>
        ))}
        {account && (
          <button
            onClick={() => {
              props.onClose();
              props.onFriends();
            }}
          >
            {t('friends')}
          </button>
        )}
      </section>
    </div>,
    document.body,
  );
}

export const TABS: { id: Tab; icon: string; key: 'tabBoards' | 'tabRooms' | 'tabPlay' | 'tabMore' }[] = [
  { id: 'boards', icon: 'boards', key: 'tabBoards' },
  { id: 'rooms', icon: 'rooms', key: 'tabRooms' },
  { id: 'play', icon: 'play', key: 'tabPlay' },
  { id: 'more', icon: 'more', key: 'tabMore' },
];

export function BottomBar({ tab, onTab }: { tab: Tab; onTab(t: Tab): void }) {
  const t = useT();
  const sound = useSound();
  return (
    <nav className="bottom-bar" aria-label={t('mainMenu')}>
      {TABS.map((x) => (
        <button
          key={x.id}
          className={`${x.id === 'play' ? 'play-slot' : ''}${x.id === tab ? ' on' : ''}`}
          aria-current={x.id === tab ? 'page' : undefined}
          onClick={() => {
            sound('tap');
            onTab(x.id);
          }}
        >
          <span className="slot-icon">
            <Glyph name={x.icon} size={x.id === 'play' ? 28 : 22} />
          </span>
          <span className="slot-label">{t(x.key)}</span>
        </button>
      ))}
    </nav>
  );
}

/** A tab screen: content scrolling, an optional action pinned above the bottom bar. */
export function TabScreen(props: { className?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className={`screen tab-screen ${props.className ?? ''}`}>
      {props.children}
      {props.action && <div className="tab-action">{props.action}</div>}
    </main>
  );
}
