import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameClient, type SocketLike } from './net/client';
import { beaconSend, createReporter, installErrorReporting, reportUrl } from './net/errors';
import { defaultServerUrl, healthUrl } from './net/url';
import { SoundProvider } from './audio/context';
import { createSoundBoard, htmlAudio } from './audio/sounds';
import { PwaProvider, type Pwa } from './pwa/context';
import { createConnectivity, createInstall, createUpdate, isIos, isStandalone } from './pwa/install';
import { createPush } from './pwa/push';
import { App, PRIVACY_PATH } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ClientProvider } from './ui/context';
import './styles.css';
import './menu.css';

const url = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? defaultServerUrl(location, import.meta.env.DEV);
// Crash reports go to our own server; the page path only, never the query string.
const reportError = createReporter({ url: reportUrl(url), version: __APP_VERSION__, page: () => location.pathname, send: beaconSend });
installErrorReporting(window, reportError);

const client = new GameClient({
  url,
  // The browser WebSocket has the SocketLike shape; its handler types are just stricter.
  createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
  storage: localStorage,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
});
client.start();
// A free host sleeps when idle; an HTTP request wakes it right away, while the socket keeps retrying.
fetch(healthUrl(url), { cache: 'no-store', mode: 'no-cors' }).then(() => client.wakeUp(), () => {});

const room = new URLSearchParams(location.search).get('room') ?? undefined;
if (room) history.replaceState(null, '', location.pathname);

const initialPage = location.pathname.replace(/\/+$/, '') === PRIVACY_PATH ? 'privacy' : undefined;

const pwa: Pwa = { install: createInstall(window, localStorage), update: createUpdate(), online: createConnectivity(window) };
// The service worker only exists in the production build; a waiting update is offered as "Reload".
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({ onNeedRefresh: () => pwa.update.ready(() => void updateSW(true)) });
  });
  // Notifications need the service worker, so they exist only in the production build too.
  pwa.push = createPush({
    ios: isIos(navigator),
    standalone: isStandalone(window),
    permission: () => ('Notification' in window && 'PushManager' in window ? Notification.permission : null),
    requestPermission: () => Notification.requestPermission(),
    pushManager: () =>
      Promise.race([
        navigator.serviceWorker.ready.then((r) => r.pushManager),
        new Promise<null>((done) => setTimeout(() => done(null), 10_000)),
      ]),
  });
  void pwa.push.refresh();
}

const sound = createSoundBoard({
  backend: htmlAudio,
  doc: document,
  ...(typeof navigator.vibrate === 'function' ? { vibrate: (p: number | number[]) => navigator.vibrate(p) } : {}),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onError={reportError}>
      <PwaProvider pwa={pwa}>
        <ClientProvider client={client} storage={localStorage}>
          <SoundProvider board={sound}>
            <App initialRoom={room} initialPage={initialPage} />
          </SoundProvider>
        </ClientProvider>
      </PwaProvider>
    </ErrorBoundary>
  </StrictMode>,
);
