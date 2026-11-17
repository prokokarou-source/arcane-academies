/** Calls to /api/admin/* with the game login (Bearer) and, once a code was entered, the admin session. */
import { httpUrl } from '../net/api';

export interface AdminReply<T = Record<string, unknown>> {
  status: number;
  body: T | null;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'text'>>;

export function createAdminApi(serverUrl: string, token: string, fetchFn: Fetch) {
  let session: string | null = null;
  const call = async <T = Record<string, unknown>>(path: string, body?: unknown): Promise<AdminReply<T>> => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    if (session) headers['x-admin-session'] = session;
    try {
      const res = await fetchFn(httpUrl(serverUrl, `/api/admin/${path}`), {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        cache: 'no-store',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      let parsed: T | null = null;
      try {
        parsed = text ? (JSON.parse(text) as T) : null;
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed };
    } catch {
      return { status: 0, body: null };
    }
  };
  return {
    call,
    setSession(s: string | null) {
      session = s;
    },
    hasSession: () => session !== null,
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

// Shapes the server sends (see packages/server/src/insights.ts).
export type Mode = 'bots' | 'casual' | 'ranked' | 'room';
export interface WindowNumbers {
  visitors: number;
  activePlayers: number;
  newAccounts: number;
  games: Record<Mode, { started: number; finished: number }>;
  funnel: { opened: number; started: number; term2: number; finished: number; secondGame: number };
  nextDay: { cohort: number; returned: number };
  nextWeek: { cohort: number; returned: number };
}
export interface Numbers {
  today: WindowNumbers;
  week: WindowNumbers;
  month: WindowNumbers;
  live: { online: number; connections: number; gamesInProgress: number };
  at: number;
}
export interface FeedbackItem {
  id: string;
  username: string;
  kind: 'bug' | 'idea' | 'other';
  text: string;
  device: string;
  version: string;
  screen: string;
  at: number;
  read: boolean;
  hasScreenshot: boolean;
}

/** "42%" of a part, or "–" when there is nothing to divide by. */
export const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : '–');
