/** Addresses the client derives from the page it was opened on. */

/** The game server runs next to the page on port 8787; https pages must use wss. */
export function defaultServerUrl(loc: { protocol: string; hostname: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:8787`;
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
