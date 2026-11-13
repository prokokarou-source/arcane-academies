import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameClient, type SocketLike } from './net/client';
import { defaultServerUrl } from './net/url';
import { SoundProvider } from './audio/context';
import { createSoundBoard, htmlAudio } from './audio/sounds';
import { PwaProvider, type Pwa } from './pwa/context';
import { createConnectivity, createInstall, createUpdate } from './pwa/install';
import { App } from './ui/App';
import { ClientProvider } from './ui/context';
import './styles.css';

const url = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? defaultServerUrl(location, import.meta.env.DEV);
const client = new GameClient({
  url,
  // The browser WebSocket has the SocketLike shape; its handler types are just stricter.
  createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
  storage: localStorage,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
});
client.start();

const room = new URLSearchParams(location.search).get('room') ?? undefined;
if (room) history.replaceState(null, '', location.pathname);

const pwa: Pwa = { install: createInstall(window, localStorage), update: createUpdate(), online: createConnectivity(window) };
// The service worker only exists in the production build; a waiting update is offered as "Reload".
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({ onNeedRefresh: () => pwa.update.ready(() => void updateSW(true)) });
  });
}

const sound = createSoundBoard({
  backend: htmlAudio,
  doc: document,
  ...(typeof navigator.vibrate === 'function' ? { vibrate: (p: number | number[]) => navigator.vibrate(p) } : {}),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaProvider pwa={pwa}>
      <ClientProvider client={client} storage={localStorage}>
        <SoundProvider board={sound}>
          <App initialRoom={room} />
        </SoundProvider>
      </ClientProvider>
    </PwaProvider>
  </StrictMode>,
);
