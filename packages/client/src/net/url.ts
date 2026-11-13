/** Addresses the client derives from the page it was opened on. */

/**
 * Where the game server is. In development it runs on port 8787 next to the Vite page;
 * when deployed, the server also serves the page, so it is the page's own address. https pages need wss.
 */
export function defaultServerUrl(loc: { protocol: string; hostname: string; host: string }, dev: boolean): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return dev ? `${scheme}://${loc.hostname}:8787` : `${scheme}://${loc.host}`;
}

const LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * The link friends open to join a room. A page opened as localhost would hand out a link that only works
 * on this computer, so the dev server's Wi-Fi address is used instead when there is one.
 */
export function inviteLink(code: string, loc: { origin: string; hostname: string }, lanOrigin: string | null): string {
  const origin = LOCAL.includes(loc.hostname) && lanOrigin ? lanOrigin : loc.origin;
  return `${origin}/?room=${encodeURIComponent(code)}`;
}
