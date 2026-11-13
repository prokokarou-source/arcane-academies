/** The rejoin token of the seat this phone holds, kept across reloads. */
export interface Session {
  code: string;
  token: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'arcane.session';

export function loadSession(storage: Store): Session | null {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as Partial<Session> | null;
    return v && typeof v.code === 'string' && typeof v.token === 'string' ? { code: v.code, token: v.token } : null;
  } catch {
    return null;
  }
}

export function saveSession(storage: Store, s: Session): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or full storage: the game still works, only reload-rejoin is lost.
  }
}

export function clearSession(storage: Store): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // ignore
  }
}
