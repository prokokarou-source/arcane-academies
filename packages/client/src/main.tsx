import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameClient, type SocketLike } from './net/client';
import { defaultServerUrl } from './net/url';
import { App } from './ui/App';
import { ClientProvider } from './ui/context';
import './styles.css';

const url = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? defaultServerUrl(location);
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={client} storage={localStorage}>
      <App initialRoom={room} />
    </ClientProvider>
  </StrictMode>,
);
