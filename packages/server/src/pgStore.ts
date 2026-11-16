import pg from 'pg';
import type { FriendLink, FriendRow, GameRecord, StatTotals, Store, StoredUser, User } from './store';
import { NO_STATS, usernameKey } from './store';

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
  `create table if not exists game_results (
     id bigserial primary key,
     user_id bigint not null references users(id) on delete cascade,
     academy_id text not null,
     score integer not null,
     place integer not null,
     won boolean not null,
     players integer not null,
     played_at timestamptz not null default now()
   )`,
  `create index if not exists game_results_user on game_results(user_id, played_at desc)`,
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

  async setPassword(userId: string, passHash: string): Promise<void> {
    await this.q('update users set pass_hash = $2 where id = $1', [userId, passHash]);
  }

  async deleteSessions(userId: string, keepTokenHash?: string): Promise<void> {
    await this.q('delete from sessions where user_id = $1 and token_hash is distinct from $2', [userId, keepTokenHash ?? null]);
  }

  async deleteUser(userId: string): Promise<void> {
    // Sessions, friendships and results go with the user (on delete cascade).
    await this.q('delete from users where id = $1', [userId]);
  }

  async recordResult(r: GameRecord): Promise<void> {
    await this.q(
      `insert into game_results (user_id, academy_id, score, place, won, players, played_at)
       select $1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0) where exists (select 1 from users where id = $1)`,
      [r.userId, r.academyId, r.score, r.place, r.won, r.players, r.playedAt],
    );
  }

  async totals(userIds: string[]): Promise<Map<string, StatTotals>> {
    const out = new Map<string, StatTotals>(userIds.map((id) => [id, { ...NO_STATS }]));
    if (!userIds.length) return out;
    const r = await this.q(
      `select user_id, count(*)::int as games, count(*) filter (where won)::int as wins,
              coalesce(sum(score), 0)::int as total, coalesce(max(score), 0)::int as best
       from game_results where user_id = any($1::bigint[]) group by user_id`,
      [userIds],
    );
    for (const row of r.rows) out.set(String(row.user_id), { games: row.games, wins: row.wins, totalScore: row.total, bestScore: row.best });
    return out;
  }

  async history(userId: string, limit: number): Promise<GameRecord[]> {
    const r = await this.q(
      `select academy_id, score, place, won, players, played_at from game_results
       where user_id = $1 order by played_at desc, id desc limit $2`,
      [userId, limit],
    );
    return r.rows.map((row) => ({
      userId,
      academyId: row.academy_id,
      score: row.score,
      place: row.place,
      won: row.won,
      players: row.players,
      playedAt: new Date(row.played_at).getTime(),
    }));
  }
}
