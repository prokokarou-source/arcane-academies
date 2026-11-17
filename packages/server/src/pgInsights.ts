import type { AdminFactor, AnalyticsEvent, EventKind, FeedbackItem, FeedbackKind, Insights, Mode, NewFeedback } from './insights';

/** Run on every start after the store's own migrations; each statement is safe to repeat. */
const MIGRATIONS = [
  // Set ONLY by hand in the database (see docs/admin.md); the app never writes it.
  `alter table users add column if not exists is_admin boolean not null default false`,
  `create table if not exists analytics_events (
     id bigserial primary key,
     kind text not null,
     at timestamptz not null default now(),
     day date not null,
     device text,
     user_id bigint references users(id) on delete set null,
     mode text,
     game text
   )`,
  `create index if not exists analytics_events_at on analytics_events(at)`,
  `create index if not exists analytics_events_open on analytics_events(device, at) where kind = 'open'`,
  // 'open' once per device per day, 'active' once per account per day.
  `create unique index if not exists analytics_events_daily
     on analytics_events(kind, day, coalesce(device, ''), coalesce(user_id, 0)) where kind in ('open', 'active')`,
  `create table if not exists feedback (
     id bigserial primary key,
     user_id bigint references users(id) on delete set null,
     username text not null,
     kind text not null,
     body text not null,
     device text not null default '',
     app_version text not null default '',
     screen text not null default '',
     screenshot text,
     read boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists feedback_created on feedback(created_at desc)`,
  `create table if not exists admin_factors (
     user_id bigint primary key references users(id) on delete cascade,
     secret_box text not null,
     confirmed boolean not null default false,
     backup_hashes text[] not null default '{}',
     last_step bigint not null default -1,
     failures integer not null default 0,
     locked_until timestamptz,
     updated_at timestamptz not null default now()
   )`,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;

const ms = (v: Date | string | null) => (v === null ? 0 : new Date(v).getTime());
const iso = (t: number) => new Date(t).toISOString();

/** Insights in the same Postgres database as accounts, sharing PgStore's pool. */
export class PgInsights implements Insights {
  private migrated: Promise<void> | null = null;

  constructor(private readonly query: Query) {}

  init(): Promise<void> {
    this.migrated ??= (async () => {
      for (const sql of MIGRATIONS) await this.query(sql, []);
    })().catch((e: unknown) => {
      this.migrated = null;
      throw e;
    });
    return this.migrated;
  }

  private async q(sql: string, params: unknown[]) {
    await this.init();
    return this.query(sql, params);
  }

  async addEvent(e: AnalyticsEvent): Promise<void> {
    await this.q(
      `insert into analytics_events (kind, at, day, device, user_id, mode, game)
       select $1, $2::timestamptz, ($2::timestamptz at time zone 'UTC')::date, $3, $4::bigint, $5, $6
       where $4::bigint is null or exists (select 1 from users where id = $4::bigint)
       on conflict do nothing`,
      [e.kind, iso(e.at), e.device, e.userId, e.mode ?? null, e.game ?? null],
    );
  }

  async events(since: number): Promise<AnalyticsEvent[]> {
    const r = await this.q(`select kind, at, device, user_id, mode, game from analytics_events where at >= $1 order by at`, [iso(since)]);
    return r.rows.map((x) => ({
      kind: x.kind as EventKind,
      at: ms(x.at),
      device: x.device,
      userId: x.user_id === null ? null : String(x.user_id),
      mode: x.mode as Mode | null,
      game: x.game,
    }));
  }

  async newDevices(since: number): Promise<Map<string, number>> {
    const r = await this.q(
      `select device, min(at) as first from analytics_events where kind = 'open' and device is not null
       group by device having min(at) >= $1`,
      [iso(since)],
    );
    return new Map(r.rows.map((x) => [x.device as string, ms(x.first)]));
  }

  async addFeedback(f: NewFeedback): Promise<string> {
    const r = await this.q(
      `insert into feedback (user_id, username, kind, body, device, app_version, screen, screenshot, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [f.userId, f.username, f.kind, f.text, f.device, f.version, f.screen, f.screenshot, iso(f.at)],
    );
    return String(r.rows[0].id);
  }

  async feedback(limit: number): Promise<FeedbackItem[]> {
    const r = await this.q(
      `select id, username, kind, body, device, app_version, screen, screenshot is not null as has_shot, read, created_at
       from feedback order by created_at desc, id desc limit $1`,
      [limit],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      username: x.username,
      kind: x.kind as FeedbackKind,
      text: x.body,
      device: x.device,
      version: x.app_version,
      screen: x.screen,
      at: ms(x.created_at),
      read: x.read,
      hasScreenshot: x.has_shot,
    }));
  }

  async screenshot(id: string): Promise<string | null> {
    if (!/^\d{1,18}$/.test(id)) return null;
    const r = await this.q(`select screenshot from feedback where id = $1`, [id]);
    return r.rows[0]?.screenshot ?? null;
  }

  async setFeedbackRead(id: string, read: boolean): Promise<void> {
    if (!/^\d{1,18}$/.test(id)) return;
    await this.q(`update feedback set read = $2 where id = $1`, [id, read]);
  }

  async isAdmin(userId: string): Promise<boolean> {
    if (!/^\d{1,18}$/.test(userId)) return false;
    const r = await this.q(`select is_admin from users where id = $1`, [userId]);
    return r.rows[0]?.is_admin === true;
  }

  async adminFactor(userId: string): Promise<AdminFactor | null> {
    const r = await this.q(
      `select secret_box, confirmed, backup_hashes, last_step, failures, locked_until from admin_factors where user_id = $1`,
      [userId],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      secretBox: x.secret_box,
      confirmed: x.confirmed,
      backupHashes: x.backup_hashes ?? [],
      lastStep: Number(x.last_step),
      failures: x.failures,
      lockedUntil: ms(x.locked_until),
    };
  }

  async saveAdminFactor(userId: string, f: AdminFactor): Promise<void> {
    await this.q(
      `insert into admin_factors (user_id, secret_box, confirmed, backup_hashes, last_step, failures, locked_until, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (user_id) do update set secret_box = $2, confirmed = $3, backup_hashes = $4, last_step = $5,
         failures = $6, locked_until = $7, updated_at = now()`,
      [userId, f.secretBox, f.confirmed, f.backupHashes, f.lastStep, f.failures, f.lockedUntil ? iso(f.lockedUntil) : null],
    );
  }
}
