/**
 * HTTP calls to our own server: in-app feedback and the few usage events the server cannot see
 * itself (the app was opened, offline Bots games). The device id is a random value made on this
 * device; it carries no name, and the server never stores IP addresses with it.
 */

export type FeedbackKind = 'bug' | 'idea' | 'other';
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'other'];
export const MAX_FEEDBACK_TEXT = 2000;

export interface FeedbackDraft {
  kind: FeedbackKind;
  text: string;
  /** A downscaled image as a data URL, or null. */
  screenshot: string | null;
  /** Where the player was, e.g. "game › more". */
  screen: string;
}

export type FeedbackResult = 'ok' | 'login' | 'too_many' | 'error';

export type TrackEvent = { kind: 'open' } | { kind: 'game_start' | 'term2' | 'game_finish'; mode: 'bots'; game: string };

export interface Api {
  feedback(d: FeedbackDraft, token: string): Promise<FeedbackResult>;
  track(e: TrackEvent, token: string | null): void;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** An HTTP(S) address on the game server, next to its WebSocket address. */
export function httpUrl(serverUrl: string, path: string): string {
  const u = new URL(serverUrl);
  u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
  u.pathname = path;
  u.search = '';
  return u.toString();
}

const DEVICE_KEY = 'arcane.device';
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** This device's random id, made once and kept (a fresh one each time if storage is blocked). */
export function deviceId(storage: Store, random: () => string = randomId): string {
  try {
    const v = storage.getItem(DEVICE_KEY);
    if (v && DEVICE_RE.test(v)) return v;
  } catch {
    // ignore
  }
  const id = random();
  try {
    storage.setItem(DEVICE_KEY, id);
  } catch {
    // ignore: counted as a new device next time
  }
  return id;
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The socket address with the device id, so the server can count this device's games. */
export function withDevice(serverUrl: string, device: string): string {
  const u = new URL(serverUrl);
  u.searchParams.set('d', device);
  return u.toString();
}

/** A short, nameless device summary, e.g. "Android · Chrome · 412×915". */
export function deviceSummary(ua: string, width: number, height: number): string {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'Other';
  return `${os} · ${browser} · ${Math.round(width)}×${Math.round(height)}`;
}

export interface ApiDeps {
  serverUrl: string;
  fetch: typeof fetch;
  device: string;
  version: string;
  /** Device summary attached to feedback. */
  deviceInfo: () => string;
}

export function createApi(d: ApiDeps): Api {
  const headers = (token: string | null): Record<string, string> => ({
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  return {
    async feedback(draft, token) {
      try {
        const res = await d.fetch(httpUrl(d.serverUrl, '/api/feedback'), {
          method: 'POST',
          headers: headers(token),
          body: JSON.stringify({ ...draft, device: d.deviceInfo().slice(0, 160), version: d.version.slice(0, 32), screen: draft.screen.slice(0, 60) }),
        });
        if (res.ok) return 'ok';
        if (res.status === 401) return 'login';
        if (res.status === 429) return 'too_many';
        return 'error';
      } catch {
        return 'error';
      }
    },
    track(e, token) {
      void d
        .fetch(httpUrl(d.serverUrl, '/api/event'), { method: 'POST', keepalive: true, headers: headers(token), body: JSON.stringify({ ...e, device: d.device }) })
        .catch(() => {});
    },
  };
}

/** Shrinks a picked image to at most `max` px on its long side, as a JPEG data URL (~100-300 kB). */
export async function shrinkImage(file: Blob, max = 1280, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}
