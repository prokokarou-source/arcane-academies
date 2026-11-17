import { useEffect, useRef, useState } from 'react';
import { useOnline, useUpdate } from '../pwa/context';
import type { Queue } from '../net/menuTypes';
import { Account } from './Account';
import { DeskShell, FriendsRail, SideNav } from './Desk';
import { useWide } from './layout';
import { useClient, useClientState, usePrefs, useT } from './context';
import { Feedback } from './Feedback';
import { Friends } from './Friends';
import { Game } from './Game';
import { Leaderboards } from './Leaderboards';
import { Lobby } from './Lobby';
import { BottomBar, MenuHeader, type Tab } from './Menu';
import { About, Faq, LanguagePage, More, WhatsNew, type MorePage } from './More';
import { DEFAULT_PLAY, Play, QueueWait, type PlaySel } from './Play';
import { Privacy } from './Privacy';
import { Profile } from './Profile';
import { Reveal } from './Reveal';
import { CreateRoom, Rooms } from './Rooms';
import { Rules } from './Rules';
import { Settings } from './Settings';
import { RecoveryCodeDialog } from './Safety';

/** A screen opened on top of the menu tabs; Back returns to the one below. */
type Page = { id: MorePage | 'createRoom'; user?: string };

/** The privacy notice has its own address (/privacy) so it can be linked from outside the app. */
export const PRIVACY_PATH = '/privacy';

export function App({ initialRoom, initialPage }: { initialRoom?: string; initialPage?: 'privacy' }) {
  const state = useClientState();
  const client = useClient();
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialRoom ? 'rooms' : 'play');
  const [stack, setStack] = useState<Page[]>(initialPage ? [{ id: initialPage }] : []);
  const [playSel, setPlaySel] = useState<PlaySel>(DEFAULT_PLAY);
  const [boardQueue, setBoardQueue] = useState<Queue>('3-5');
  const [roomCode, setRoomCode] = useState(initialRoom);
  const online = useOnline();
  const update = useUpdate();
  const [prefs, setPrefs] = usePrefs();
  // The Animations setting turns off every transition and animation, like the system's reduced motion.
  useEffect(() => {
    document.documentElement.classList.toggle('no-anim', !prefs.animations);
  }, [prefs.animations]);
  // Before a room, a connection that takes more than a moment means the host is waking up.
  const [slow, setSlow] = useState(false);
  const open = state.conn === 'open';
  useEffect(() => {
    if (open) return setSlow(false);
    const id = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(id);
  }, [open]);
  // Entering a lobby or game closes whatever menu page led there.
  const inRoom = !!(state.lobby || state.game);
  useEffect(() => {
    if (inRoom) setStack([]);
  }, [inRoom]);

  const push = (p: Page) => setStack((s) => [...s, p]);
  const back = () => setStack((s) => s.slice(0, -1));
  const top = stack.at(-1);
  const goTab = (x: Tab) => {
    setRoomCode(undefined);
    setTab(x);
    // The laptop sidebar is always there, so a tab also closes any page opened over the tabs.
    setStack([]);
  };
  const wide = useWide();
  // Laptop: menu screens sit in the middle of three columns. The game, lobby and queue keep their own full screen.
  const desk = wide && !state.game && !state.lobby;

  /** Logged-in players play under their username; guests under their saved name, made up once if empty. */
  const playName = () => {
    if (state.account) return state.account;
    let name = prefs.name.trim();
    if (!name) {
      name = `Guest${1000 + Math.floor(Math.random() * 9000)}`;
      setPrefs({ ...prefs, name });
    }
    return name;
  };

  const leavePrivacy = () => {
    if (location.pathname === PRIVACY_PATH) history.replaceState(null, '', '/');
    back();
  };

  const playRanked = (q: Queue) => {
    if (!state.account) return push({ id: 'account' });
    setPlaySel({ ...playSel, mode: 'ranked', queue: q });
    goTab('play');
    client.queueJoin('ranked', q, state.account);
  };

  const id = top?.id;
  // The screen name sent with feedback: the last few places the player was before opening it.
  const here = id ?? (state.game ? 'game' : state.lobby ? 'lobby' : state.queue ? 'queue' : tab);
  const trail = useRef<string[]>([]);
  if (trail.current.at(-1) !== here) trail.current = [...trail.current, here].slice(-4);
  let screen;
  let menu = false;
  if (id === 'privacy' && !inRoom) screen = <Privacy onBack={leavePrivacy} />;
  else if (id === 'settings') screen = <Settings onBack={back} />;
  else if (id === 'rules' && (state.game || (!state.lobby && !state.restoring))) screen = <Rules onBack={back} />;
  else if (id === 'friends' && !state.game)
    screen = <Friends onBack={back} onAccount={() => push({ id: 'account' })} onProfile={(user) => push({ id: 'profile', user })} />;
  else if (state.game) screen = <Game onSettings={() => push({ id: 'settings' })} onRules={() => push({ id: 'rules' })} />;
  else if (state.lobby) screen = <Lobby onFriends={state.account ? () => push({ id: 'friends' }) : undefined} />;
  else if (state.queue) screen = <QueueWait playName={playName} />;
  else if (state.restoring)
    screen = (
      <main className="screen center">
        <p className="status loading">{t('connecting')}</p>
      </main>
    );
  else if (id === 'account' || (id === 'profile' && !top?.user && !state.account))
    screen = <Account onBack={back} onPrivacy={() => push({ id: 'privacy' })} />;
  else if (id === 'profile') screen = <Profile key={top?.user ?? ''} username={top?.user} onBack={back} />;
  else if (id === 'news') screen = <WhatsNew onBack={back} />;
  else if (id === 'language') screen = <LanguagePage onBack={back} />;
  else if (id === 'faq') screen = <Faq onBack={back} />;
  else if (id === 'about') screen = <About onBack={back} />;
  else if (id === 'feedback') screen = <Feedback onBack={back} onLogin={() => push({ id: 'account' })} screen={trail.current.slice(0, -1).join(' › ') || 'more'} />;
  else if (id === 'createRoom') screen = <CreateRoom onBack={back} playName={playName} />;
  else {
    menu = true;
    screen =
      tab === 'play' ? (
        <Play sel={playSel} onSel={setPlaySel} playName={playName} onLogin={() => push({ id: 'account' })} />
      ) : tab === 'rooms' ? (
        <Rooms playName={playName} initialCode={roomCode} onCreate={() => push({ id: 'createRoom' })} />
      ) : tab === 'boards' ? (
        <Leaderboards queue={boardQueue} onQueue={setBoardQueue} onOpen={(user) => push({ id: 'profile', user })} onPlay={playRanked} />
      ) : (
        <More onOpen={(p) => push({ id: p })} />
      );
  }

const statusBar = !online ? (
      <div className="bar bar-warn" role="status">
        {t('offlineBar')}
      </div>
    ) : state.game || state.lobby ? (
      state.conn === 'reconnecting' &&
      !state.local && (
        <div className="bar bar-warn" role="status">
          {t('reconnecting')}
        </div>
      )
    ) : (
      slow && (
        <div className="bar bar-warn" role="status">
          {t('waking')}
        </div>
      )
      );
  const banners = (
    <>
      {update.ready && (
        <div className="banner" role="status">
          <span>{t('updateReady')}</span>
          <button className="link" onClick={update.apply}>
            {t('reload')}
          </button>
        </div>
      )}
      {state.notice && (
        <div className="banner" role="alert">
          <span>{t(`notice_${state.notice}`)}</span>
          <button className="link" onClick={() => client.clearNotice()}>
            {t('dismiss')}
          </button>
        </div>
      )}
      {!state.game &&
        state.invites.map((inv) => (
          <div key={`${inv.from}/${inv.code}`} className="banner" role="alert">
            <span>{t('inviteFrom', { name: inv.from, code: inv.code })}</span>
            <span className="row">
              <button className="primary" onClick={() => client.acceptInvite(inv, playName())}>
                {t('join')}
              </button>
              <button className="link" onClick={() => client.dismissInvite(inv)}>
                {t('dismiss')}
              </button>
            </span>
          </div>
        ))}
      {state.error && (
        <div className="banner banner-error" role="alert">
          <span>{t(`error_${state.error.code}`)}</span>
          <button className="link" onClick={() => client.clearError()}>
            {t('dismiss')}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className={`app${menu && !desk ? ' with-menu' : ''}${desk ? ' app-desk' : wide && state.game ? ' app-desk-game' : ''}`}>
      {desk ? (
        <DeskShell
          nav={
            <SideNav
              tab={menu ? tab : null}
              onTab={goTab}
              onLogin={() => push({ id: 'account' })}
              onProfile={() => push({ id: 'profile' })}
              onFriends={() => push({ id: 'friends' })}
            />
          }
          aside={<FriendsRail onFriends={() => push({ id: 'friends' })} onProfile={(user) => push({ id: 'profile', user })} onLogin={() => push({ id: 'account' })} />}
        >
          {statusBar}
          {banners}
          {screen}
        </DeskShell>
      ) : (
        <>
          {statusBar}
          {menu && <MenuHeader onLogin={() => push({ id: 'account' })} onProfile={() => push({ id: 'profile' })} onFriends={() => push({ id: 'friends' })} />}
          {banners}
          {screen}
          {menu && <BottomBar tab={tab} onTab={goTab} />}
        </>
      )}
      {state.game && <Reveal />}
      <RecoveryCodeDialog />
    </div>
  );
}
