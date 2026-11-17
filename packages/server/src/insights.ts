/**
 * Player feedback, simple usage numbers and the admin's second factor, kept in our own database
 * (no third-party analytics). Events carry a random device id and, when logged in, the account id:
 * no IP addresses, no names. AI opponents and bots never produce events.
 */
import type { GameKind } from '@arcane/protocol';

export type EventKind = 'open' | 'signup' | 'active' | 'game_start' | 'term2' | 'game_finish';
export const EVENT_KINDS: readonly EventKind[] = ['open', 'signup', 'active', 'game_start', 'term2', 'game_finish'];
/** Kinds that count once per device (open) or account (active) per UTC day. */
export const DAILY_KINDS: readonly EventKind[] = ['open', 'active'];
export type Mode = GameKind;
export const MODES: readonly Mode[] = ['bots', 'casual', 'ranked', 'room'];

export interface AnalyticsEvent {
  kind: EventKind;
  /** Epoch ms. */
  at: number;
  device: string | null;
  userId: string | null;
  mode?: Mode | null;
  /** Game events: an id shared by every player's events of one game. */
  game?: string | null;
}

export type FeedbackKind = 'bug' | 'idea' | 'other';
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'other'];

export interface NewFeedback {
  userId: string;
  username: string;
  kind: FeedbackKind;
  text: string;
  /** Short device summary, e.g. "Android · Chrome · 412×915". */
  device: string;
  version: string;
  screen: string;
  /** A data:image/jpeg|png|webp;base64 URL, or null. */
  screenshot: string | null;
  at: number;
}

export interface FeedbackItem extends Omit<NewFeedback, 'screenshot' | 'userId'> {
  id: string;
  read: boolean;
  hasScreenshot: boolean;
}

/** The admin's second factor. The secret is stored encrypted (see secretBox.ts). */
export interface AdminFactor {
  secretBox: string;
  /** False until the first code from the app was entered. */
  confirmed: boolean;
  /** scrypt hashes of the unused backup codes. */
  backupHashes: string[];
  /** Last accepted TOTP time step (a code works once). */
  lastStep: number;
  /** Wrong codes in a row. */
  failures: number;
  /** Epoch ms; 0 when not locked. */
  lockedUntil: number;
}

export interface Insights {
  init(): Promise<void>;
  /** 'open' and 'active' are kept once per device / account per UTC day; repeats are ignored. */
  addEvent(e: AnalyticsEvent): Promise<void>;
  /** Every event at or after `since` (epoch ms). */
  events(since: number): Promise<AnalyticsEvent[]>;
  /** Devices whose first 'open' ever is at or after `since`, with that moment. */
  newDevices(since: number): Promise<Map<string, number>>;
  addFeedback(f: NewFeedback): Promise<string>;
  /** Newest first, without screenshots. */
  feedback(limit: number): Promise<FeedbackItem[]>;
  screenshot(id: string): Promise<string | null>;
  setFeedbackRead(id: string, read: boolean): Promise<void>;
  /** The is_admin flag; it is only ever set by hand in the database. */
  isAdmin(userId: string): Promise<boolean>;
  adminFactor(userId: string): Promise<AdminFactor | null>;
  saveAdminFactor(userId: string, f: AdminFactor): Promise<void>;
}

export const DAY_MS = 86_400_000;
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

export class MemoryInsights implements Insights {
  private rows: AnalyticsEvent[] = [];
  private daily = new Set<string>();
  private fb: (NewFeedback & { id: string; read: boolean })[] = [];
  private admins = new Set<string>();
  private factors = new Map<string, AdminFactor>();
  private nextId = 1;

  async init(): Promise<void> {}

  /** Tests and local development: the database flag, set by hand. */
  setAdmin(userId: string, on = true): void {
    if (on) this.admins.add(userId);
    else this.admins.delete(userId);
  }

  async addEvent(e: AnalyticsEvent): Promise<void> {
    if (DAILY_KINDS.includes(e.kind)) {
      const key = `${e.kind}|${utcDay(e.at)}|${e.device ?? ''}|${e.userId ?? ''}`;
      if (this.daily.has(key)) return;
      this.daily.add(key);
    }
    this.rows.push({ ...e });
  }

  async events(since: number): Promise<AnalyticsEvent[]> {
    return this.rows.filter((e) => e.at >= since).map((e) => ({ ...e }));
  }

  async newDevices(since: number): Promise<Map<string, number>> {
    const first = new Map<string, number>();
    for (const e of this.rows) if (e.kind === 'open' && e.device) first.set(e.device, Math.min(first.get(e.device) ?? Infinity, e.at));
    return new Map([...first].filter(([, at]) => at >= since));
  }

  async addFeedback(f: NewFeedback): Promise<string> {
    const id = String(this.nextId++);
    this.fb.push({ ...f, id, read: false });
    return id;
  }

  async feedback(limit: number): Promise<FeedbackItem[]> {
    return this.fb
      .slice()
      .reverse()
      .slice(0, limit)
      .map(({ screenshot, userId: _u, ...f }) => ({ ...f, hasScreenshot: !!screenshot }));
  }

  async screenshot(id: string): Promise<string | null> {
    return this.fb.find((f) => f.id === id)?.screenshot ?? null;
  }

  async setFeedbackRead(id: string, read: boolean): Promise<void> {
    const f = this.fb.find((x) => x.id === id);
    if (f) f.read = read;
  }

  async isAdmin(userId: string): Promise<boolean> {
    return this.admins.has(userId);
  }

  async adminFactor(userId: string): Promise<AdminFactor | null> {
    const f = this.factors.get(userId);
    return f ? { ...f, backupHashes: [...f.backupHashes] } : null;
  }

  async saveAdminFactor(userId: string, f: AdminFactor): Promise<void> {
    this.factors.set(userId, { ...f, backupHashes: [...f.backupHashes] });
  }
}

// ---------- the Numbers tab ----------

export interface ModeCount {
  started: number;
  finished: number;
}

export interface Retention {
  /** New devices old enough to have come back. */
  cohort: number;
  returned: number;
}

export interface WindowNumbers {
  /** Unique devices that opened the app. */
  visitors: number;
  /** Accounts that were logged in. */
  activePlayers: number;
  newAccounts: number;
  games: Record<Mode, ModeCount>;
  /** Unique players (device, or account when no device is known) per step. */
  funnel: { opened: number; started: number; term2: number; finished: number; secondGame: number };
  nextDay: Retention;
  nextWeek: Retention;
}

export interface LiveNumbers {
  /** Logged-in accounts with an open connection. */
  online: number;
  /** Open connections (guests included). */
  connections: number;
  /** Server games in progress with at least one person at the table. */
  gamesInProgress: number;
}

export interface Numbers {
  today: WindowNumbers;
  week: WindowNumbers;
  month: WindowNumbers;
  live: LiveNumbers;
  /** Epoch ms the numbers were made. */
  at: number;
}

/** How far back the Numbers tab reads: 30 days plus a week for next-week retention. */
export const NUMBERS_LOOKBACK_MS = 38 * DAY_MS;

const who = (e: AnalyticsEvent) => e.device ?? (e.userId ? `u:${e.userId}` : null);

function windowNumbers(all: AnalyticsEvent[], fresh: Map<string, number>, since: number, now: number): WindowNumbers {
  const evs = all.filter((e) => e.at >= since && e.at <= now);
  const distinct = (kind: EventKind, key: (e: AnalyticsEvent) => string | null) =>
    new Set(evs.filter((e) => e.kind === kind).map(key).filter((k): k is string => !!k));
  const games = Object.fromEntries(
    MODES.map((m) => {
      const ids = (kind: EventKind) => new Set(evs.filter((e) => e.kind === kind && e.mode === m).map((e) => e.game ?? `${who(e)}@${e.at}`)).size;
      return [m, { started: ids('game_start'), finished: ids('game_finish') }];
    }),
  ) as Record<Mode, ModeCount>;
  const perPlayer = new Map<string, Set<string>>();
  for (const e of evs) {
    const p = who(e);
    if (e.kind !== 'game_start' || !p) continue;
    perPlayer.set(p, (perPlayer.get(p) ?? new Set()).add(e.game ?? String(e.at)));
  }
  // Retention: devices first seen in the window, counted once they are old enough to have come back.
  const opensByDevice = new Map<string, Set<number>>();
  for (const e of all) if (e.kind === 'open' && e.device) opensByDevice.set(e.device, (opensByDevice.get(e.device) ?? new Set()).add(utcDay(e.at)));
  const retention = (days: number): Retention => {
    let cohort = 0;
    let returned = 0;
    for (const [device, first] of fresh) {
      if (first < since || first > now) continue;
      const d0 = utcDay(first);
      if (utcDay(now) < d0 + days) continue; // too new to tell
      cohort++;
      const seen = opensByDevice.get(device) ?? new Set();
      for (let d = d0 + 1; d <= d0 + days; d++) {
        if (seen.has(d)) {
          returned++;
          break;
        }
      }
    }
    return { cohort, returned };
  };
  return {
    visitors: distinct('open', (e) => e.device).size,
    activePlayers: distinct('active', (e) => e.userId).size,
    newAccounts: evs.filter((e) => e.kind === 'signup').length,
    games,
    funnel: {
      opened: distinct('open', who).size,
      started: perPlayer.size,
      term2: distinct('term2', who).size,
      finished: distinct('game_finish', who).size,
      secondGame: [...perPlayer.values()].filter((g) => g.size >= 2).length,
    },
    nextDay: retention(1),
    nextWeek: retention(7),
  };
}

/** Today (since 00:00 UTC), the last 7 days and the last 30 days. `events` must reach back NUMBERS_LOOKBACK_MS. */
export function computeNumbers(events: AnalyticsEvent[], fresh: Map<string, number>, now: number, live: LiveNumbers): Numbers {
  return {
    today: windowNumbers(events, fresh, utcDay(now) * DAY_MS, now),
    week: windowNumbers(events, fresh, now - 7 * DAY_MS, now),
    month: windowNumbers(events, fresh, now - 30 * DAY_MS, now),
    live,
    at: now,
  };
}

export async function loadNumbers(insights: Insights, now: number, live: LiveNumbers): Promise<Numbers> {
  const since = now - NUMBERS_LOOKBACK_MS;
  const [events, fresh] = await Promise.all([insights.events(since), insights.newDevices(since)]);
  return computeNumbers(events, fresh, now, live);
}
