import { useState } from 'react';
import { useClient, useClientState, useT } from './context';
import { Game } from './Game';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Rules } from './Rules';
import { Settings } from './Settings';

type Page = 'home' | 'rules' | 'settings';

export function App({ initialRoom }: { initialRoom?: string }) {
  const state = useClientState();
  const client = useClient();
  const t = useT();
  const [page, setPage] = useState<Page>('home');

  let screen;
  if (state.game) screen = <Game />;
  else if (state.lobby) screen = <Lobby />;
  else if (state.restoring)
    screen = (
      <main className="screen center">
        <p className="status">{t('connecting')}</p>
      </main>
    );
  else if (page === 'rules') screen = <Rules onBack={() => setPage('home')} />;
  else if (page === 'settings') screen = <Settings onBack={() => setPage('home')} />;
  else screen = <Home initialRoom={initialRoom} onRules={() => setPage('rules')} onSettings={() => setPage('settings')} />;

  return (
    <div className="app">
      {state.conn === 'reconnecting' && (
        <div className="bar bar-warn" role="status">
          {t('reconnecting')}
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
