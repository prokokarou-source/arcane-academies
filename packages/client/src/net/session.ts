/** The rejoin token of the seat this phone holds, kept across reloads. */
export interface Session {
  code: string;
  token: string;
  /** Last known host of the room, so Rematch works after a reload mid-game. */
  hostId?: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'arcane.session';

export function loadSession(storage: Store): Session | null {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as Partial<Session> | null;
    if (!v || typeof v.code !== 'string' || typeof v.token !== 'string') return null;
    return { code: v.code, token: v.token, ...(typeof v.hostId === 'string' ? { hostId: v.hostId } : {}) };
  } catch {
    return null;
  }
}

export function saveSession(storage: Store, s: Session): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or full storage: the in-memory copy still rejoins on reconnect; only reload-rejoin is lost.
  }
}

export function clearSession(storage: Store): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The saved login token. Unlike the seat, every tab shares it: logging in once logs in this browser. */
const ACCOUNT_KEY = 'arcane.account';

export function loadAccountToken(storage: Store): string | null {
  try {
    const v = JSON.parse(storage.getItem(ACCOUNT_KEY) ?? 'null') as { token?: unknown } | null;
    return v && typeof v.token === 'string' ? v.token : null;
  } catch {
    return null;
  }
}

export function saveAccountToken(storage: Store, token: string): void {
  try {
    storage.setItem(ACCOUNT_KEY, JSON.stringify({ token }));
  } catch {
    // ignore: the login lasts until this tab closes
  }
}

export function clearAccountToken(storage: Store): void {
  try {
    storage.removeItem(ACCOUNT_KEY);
  } catch {
    // ignore
  }
}
