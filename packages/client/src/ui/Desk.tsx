/**
 * The laptop menu (≥ 1024px): a permanent sidebar on the left, the current screen in the middle, friends on the right.
 * The phone keeps its header and bottom bar; these pieces are only rendered by the App on a wide window.
 */
import { useEffect, type ReactNode } from 'react';
import { useSound } from '../audio/context';
import { divisionOf } from '../net/menuTypes';
import { AvatarGlyph } from './Avatar';
import { useClient, useClientState, useT } from './context';
import { Crest } from './Icon';
import { Bell, DivisionBadge, Glyph, TABS, type Tab } from './Menu';
import { academyName, modeOf } from './Profile';

/** Sidebar order: Play first, as on the agreed draft. */
const ORDER: Tab[] = ['play', 'rooms', 'boards', 'more'];

/** My own profile, fetched once when logged in (the sidebar shows my division and rating, Play my last game). */
export function useMyProfile() {
  const client = useClient();
  const { account, profile } = useClientState();
  const mine = account && profile?.me ? profile : null;
  useEffect(() => {
    if (account && !mine) client.requestProfile();
  }, [account, mine, client]);
  return mine;
}

/** The three columns. */
export function DeskShell(props: { nav: ReactNode; children: ReactNode; aside: ReactNode }) {
  return (
    <div className="desk">
      {props.nav}
      <div className="desk-main">{props.children}</div>
      {props.aside}
    </div>
  );
}

export function SideNav(props: { tab: Tab | null; locked?: boolean; onTab(t: Tab): void; onLogin(): void; onProfile(): void; onFriends(): void }) {
  const t = useT();
  const sound = useSound();
  const { account, avatar } = useClientState();
  const mine = useMyProfile();
  // The best of my three ranked ratings stands for me in the sidebar.
  const best = mine?.ranked.filter((r) => r.rating !== null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const division = best?.division ?? divisionOf(null);
  return (
    <nav className="side-nav" aria-label={t('mainMenu')}>
      <div className="side-logo">
        <img src="/icon.svg" alt="" width={36} height={36} />
        <strong>{t('appName')}</strong>
        <Bell onFriends={props.onFriends} />
      </div>
      <div className="side-tabs">
        {ORDER.map((id) => {
          const x = TABS.find((s) => s.id === id)!;
          const on = id === props.tab;
          return (
            <button
              key={id}
              className={on ? 'on' : ''}
              aria-current={on ? 'page' : undefined}
              disabled={props.locked && !on}
              onClick={() => {
                sound('tap');
                props.onTab(id);
              }}
            >
              <Glyph name={x.icon} size={22} />
              <span>{t(x.key)}</span>
            </button>
          );
        })}
      </div>
      {account ? (
        <button className="side-me" onClick={props.onProfile} aria-label={t('openProfile')}>
          <AvatarGlyph avatar={avatar} size={40} />
          <span className="side-me-text">
            <strong className="name">{account}</strong>
            <span className="muted small">
              {t(`div_${division}`)}
              {' · '}
              <span className="num">{best?.rating ?? '—'}</span>
            </span>
          </span>
          <DivisionBadge division={division} size={28} />
        </button>
      ) : (
        <div className="side-me">
          <AvatarGlyph avatar={null} size={40} />
          <strong className="name">{t('guest')}</strong>
          <button className="primary" onClick={props.onLogin}>
            {t('logIn')}
          </button>
        </div>
      )}
    </nav>
  );
}

/** Right column: who of my friends is online, and a way to add more. */
export function FriendsRail(props: { onFriends(): void; onProfile(user: string): void; onLogin(): void }) {
  const t = useT();
  const { account, friends } = useClientState();
  const online = (friends?.friends ?? []).filter((f) => f.online);
  return (
    <aside className="friends-rail" aria-label={t('friendsHere')}>
      <h3>{t('friendsHere')}</h3>
      {!account ? (
        <>
          <p className="muted small">{t('friendsLogIn')}</p>
          <button onClick={props.onLogin}>{t('logIn')}</button>
        </>
      ) : (
        <>
          {online.length === 0 ? (
            <p className="muted small">{t('noFriendsOnline')}</p>
          ) : (
            <ul className="rail-list">
              {online.map((f) => (
                <li key={f.username}>
                  <button className="rail-friend" onClick={() => props.onProfile(f.username)} aria-label={t('profileOf', { name: f.username })}>
                    <AvatarGlyph avatar={f.avatar} size={30} />
                    <span className="name">{f.username}</span>
                    <span className="dot on" title={t('online')} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="outline rail-invite" onClick={props.onFriends}>
            {t('inviteFriend')}
          </button>
        </>
      )}
    </aside>
  );
}

/** A one-line summary of my last finished game (Play, laptop only). */
export function LastGame() {
  const t = useT();
  const mine = useMyProfile();
  const g = mine?.recent[0];
  if (!g) return null;
  return (
    <section className="last-game" aria-label={t('lastGame')}>
      <span className="mode-label">{t('lastGame')}</span>
      <Crest academyId={g.academyId} size={26} />
      <strong>{`${academyName(g.academyId)} · ${t('sideX', { side: g.side })}`}</strong>
      <span>{modeOf(t, g)}</span>
      <span>{t('placeOf', { place: g.place, players: g.players })}</span>
      <span className="num">{t('points', { n: g.score })}</span>
      {g.ratingDelta !== undefined && <span className={g.ratingDelta >= 0 ? 'up' : 'down'}>{`${g.ratingDelta >= 0 ? '+' : '−'}${Math.abs(g.ratingDelta)}`}</span>}
    </section>
  );
}
