import { useEffect, useState } from 'react';
import { useOnline, useUpdate } from '../pwa/context';
import { Account } from './Account';
import { useClient, useClientState, usePrefs, useT } from './context';
import { Friends } from './Friends';
import { Game } from './Game';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Rules } from './Rules';
import { Settings } from './Settings';

type Page = 'home' | 'rules' | 'settings' | 'account' | 'friends';

export function App({ initialRoom }: { initialRoom?: string }) {
  const state = useClientState();
  const client = useClient();
  const t = useT();
  const [page, setPage] = useState<Page>('home');
  const online = useOnline();
  const update = useUpdate();
  const [prefs] = usePrefs();
  // Before a room, a connection that takes more than a moment means the host is waking up.
  const [slow, setSlow] = useState(false);
  const open = state.conn === 'open';
  useEffect(() => {
    if (open) return setSlow(false);
    const id = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(id);
  }, [open]);

  let screen;
  if (page === 'settings') screen = <Settings onBack={() => setPage('home')} />;
  else if (page === 'rules' && (state.game || (!state.lobby && !state.restoring))) screen = <Rules onBack={() => setPage('home')} />;
  else if (page === 'account' && !state.game && !state.lobby)
    screen = <Account onBack={() => setPage('home')} onFriends={() => setPage('friends')} />;
  else if (page === 'friends' && !state.game) screen = <Friends onBack={() => setPage('home')} onAccount={() => setPage('account')} />;
  else if (state.game) screen = <Game onSettings={() => setPage('settings')} onRules={() => setPage('rules')} />;
  else if (state.lobby) screen = <Lobby onFriends={state.account ? () => setPage('friends') : undefined} />;
  else if (state.restoring)
    screen = (
      <main className="screen center">
        <p className="status">{t('connecting')}</p>
      </main>
    );
  else
    screen = (
      <Home
        initialRoom={initialRoom}
        onRules={() => setPage('rules')}
        onSettings={() => setPage('settings')}
        onAccount={() => setPage('account')}
        onFriends={() => setPage('friends')}
      />
    );

  return (
    <div className="app">
      {!online ? (
        <div className="bar bar-warn" role="status">
          {t('offlineBar')}
        </div>
      ) : state.game || state.lobby ? (
        state.conn === 'reconnecting' && (
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
      )}
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
              <button
                className="primary"
                onClick={() => {
                  setPage('home');
                  client.acceptInvite(inv, prefs.name.trim() || state.account || inv.code);
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
      {state.error && (
        <div className="banner banner-error" role="alert">
          <span>{t(`error_${state.error.code}`)}</span>
          <button className="link" onClick={() => client.clearError()}>
            {t('dismiss')}
          </button>
        </div>
      )}
      {screen}
    </div>
  );
}
