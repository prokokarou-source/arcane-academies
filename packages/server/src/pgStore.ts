import pg from 'pg';
import type { PushSub } from '@arcane/protocol';
import type { FriendLink, FriendRow, Store, StoredUser, User } from './store';
import { MAX_PUSH_SUBS, usernameKey } from './store';

/** Run on every start; each statement is safe to repeat. */
const MIGRATIONS = [
  `create table if not exists users (
     id bigserial primary key,
     username text not null,
     username_key text not null unique,
     pass_hash text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists sessions (
     token_hash text primary key,
     user_id bigint not null references users(id) on delete cascade,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists sessions_user on sessions(user_id)`,
  `create table if not exists friendships (
     requester bigint not null references users(id) on delete cascade,
     addressee bigint not null references users(id) on delete cascade,
     accepted boolean not null default false,
     created_at timestamptz not null default now(),
     primary key (requester, addressee)
   )`,
  `create index if not exists friendships_addressee on friendships(addressee)`,
  `create table if not exists push_subscriptions (
     endpoint text primary key,
     user_id bigint not null references users(id) on delete cascade,
     p256dh text not null,
     auth text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists push_subscriptions_user on push_subscriptions(user_id)`,
];

const user = (r: { id: string | number; username: string }): User => ({ id: String(r.id), username: r.username });

/** Postgres store (e.g. a free Neon database). The connection string comes from DATABASE_URL. */
export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    // Neon's URL carries sslmode=require; a small pool is plenty for a free instance.
    this.pool = new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 });
    // An idle client dropping (Neon suspends idle compute) must not crash the server.
    this.pool.on('error', (e) => console.error('database pool error:', e.message));
  }

  private migrated: Promise<void> | null = null;

  /** Create missing tables. A failure (database asleep or unreachable) is retried on the next query. */
  init(): Promise<void> {
    this.migrated ??= (async () => {
      for (const sql of MIGRATIONS) await this.pool.query(sql);
    })().catch((e: unknown) => {
      this.migrated = null;
      throw e;
    });
    return this.migrated;
  }

  private async q(sql: string, params: unknown[]) {
    await this.init();
    return this.pool.query(sql, params);
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  async createUser(username: string, passHash: string): Promise<User | null> {
    const r = await this.q(
      `insert into users (username, username_key, pass_hash) values ($1, $2, $3)
       on conflict (username_key) do nothing returning id, username`,
      [username, usernameKey(username), passHash],
    );
    return r.rows[0] ? user(r.rows[0]) : null;
  }

  async findUser(username: string): Promise<StoredUser | null> {
    const r = await this.q('select id, username, pass_hash from users where username_key = $1', [usernameKey(username)]);
    const row = r.rows[0];
    return row ? { ...user(row), passHash: row.pass_hash } : null;
  }

  async createSession(tokenHash: string, userId: string): Promise<void> {
    await this.q('insert into sessions (token_hash, user_id) values ($1, $2)', [tokenHash, userId]);
  }

  async sessionUser(tokenHash: string): Promise<User | null> {
    const r = await this.q('select u.id, u.username from sessions s join users u on u.id = s.user_id where s.token_hash = $1', [tokenHash]);
    return r.rows[0] ? user(r.rows[0]) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.q('delete from sessions where token_hash = $1', [tokenHash]);
  }

  async link(a: string, b: string): Promise<FriendLink | null> {
    const r = await this.q(
      `select requester, addressee, accepted from friendships
       where (requester = $1 and addressee = $2) or (requester = $2 and addressee = $1) limit 1`,
      [a, b],
    );
    const row = r.rows[0];
    return row ? { from: String(row.requester), to: String(row.addressee), accepted: row.accepted } : null;
  }

  async addRequest(from: string, to: string): Promise<void> {
    await this.q(
      `insert into friendships (requester, addressee)
       select $1, $2 where not exists (select 1 from friendships where requester = $2 and addressee = $1)
       on conflict do nothing`,
      [from, to],
    );
  }

  async accept(from: string, to: string): Promise<void> {
    await this.q('update friendships set accepted = true where requester = $1 and addressee = $2', [from, to]);
  }

  async removeLink(a: string, b: string): Promise<void> {
    await this.q('delete from friendships where (requester = $1 and addressee = $2) or (requester = $2 and addressee = $1)', [a, b]);
  }

  async friendRows(userId: string): Promise<FriendRow[]> {
    const r = await this.q(
      `select u.id, u.username, f.accepted, f.requester = $1 as outgoing
       from friendships f join users u on u.id = case when f.requester = $1 then f.addressee else f.requester end
       where f.requester = $1 or f.addressee = $1`,
      [userId],
    );
    return r.rows.map((row) => ({ other: user(row), accepted: row.accepted, outgoing: row.outgoing }));
  }

  async addPushSub(userId: string, sub: PushSub): Promise<void> {
    await this.q(
      `insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, $3, $4)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now()`,
      [sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth],
    );
    await this.q(
      `delete from push_subscriptions where user_id = $1 and endpoint not in
       (select endpoint from push_subscriptions where user_id = $1 order by created_at desc limit $2)`,
      [userId, MAX_PUSH_SUBS],
    );
  }

  async pushSubs(userId: string): Promise<PushSub[]> {
    const r = await this.q('select endpoint, p256dh, auth from push_subscriptions where user_id = $1', [userId]);
    return r.rows.map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
  }

  async removePushSub(endpoint: string, userId?: string): Promise<void> {
    if (userId === undefined) await this.q('delete from push_subscriptions where endpoint = $1', [endpoint]);
    else await this.q('delete from push_subscriptions where endpoint = $1 and user_id = $2', [endpoint, userId]);
  }
}
