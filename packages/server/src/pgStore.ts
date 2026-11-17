import pg from 'pg';
import { avatarKey, parseAvatarKey, START_RATING, type Avatar, type PushSub, type Queue } from '@arcane/protocol';
import type { Account, BoardScope, FriendLink, FriendRow, GameRecord, ProfileStats, RankedRow, RatingRow, Report, StatTotals, Store, StoredUser, User } from './store';
import { MAX_PUSH_SUBS, NO_STATS, sortAcademies, usernameKey, withAvatar } from './store';
import { streaks } from './rating';

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
  `create table if not exists push_subscriptions (
     endpoint text primary key,
     user_id bigint not null references users(id) on delete cascade,
     p256dh text not null,
     auth text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists push_subscriptions_user on push_subscriptions(user_id)`,
  `alter table users add column if not exists recovery_hash text`,
  `create table if not exists blocks (
     blocker bigint not null references users(id) on delete cascade,
     blocked bigint not null references users(id) on delete cascade,
     created_at timestamptz not null default now(),
     primary key (blocker, blocked)
   )`,
  `create index if not exists blocks_blocked on blocks(blocked)`,
  `create table if not exists reports (
     id bigserial primary key,
     reporter_id bigint references users(id) on delete set null,
     reporter text not null,
     target_id bigint references users(id) on delete set null,
     target text not null,
     reason text not null,
     note text not null default '',
     room_code text,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists reports_created on reports(created_at desc)`,
  // Avatar as "icon:color"; null = the default.
  `alter table users add column if not exists avatar text`,
  // Ranked and profiles (additive): country, game kind/queue/side, rating change, ratings per queue.
  `alter table users add column if not exists country text`,
  `alter table game_results add column if not exists kind text`,
  `alter table game_results add column if not exists queue text`,
  `alter table game_results add column if not exists side text`,
  `alter table game_results add column if not exists rating_delta integer`,
  `create table if not exists ratings (
     user_id bigint not null references users(id) on delete cascade,
     queue text not null,
     rating integer not null,
     games integer not null default 0,
     updated_at timestamptz not null default now(),
     primary key (user_id, queue)
   )`,
  `create index if not exists ratings_board on ratings(queue, rating desc)`,
];

/** Rated users of one queue in a scope, with rank() inside the scope. $1 queue, $2 ids or null, $3 countries or null. */
const RANKED = `select u.id, u.username, u.username_key, u.avatar, u.country, r.rating, r.games,
         rank() over (order by r.rating desc)::int as rank
  from ratings r join users u on u.id = r.user_id
  where r.queue = $1 and ($2::bigint[] is null or r.user_id = any($2::bigint[])) and ($3::text[] is null or u.country = any($3::text[]))`;

const scopeParams = (s: BoardScope) => [s.userIds ?? null, s.countries ?? null];

const user = (r: { id: string | number; username: string; avatar?: string | null }): User => ({
  id: String(r.id),
  username: r.username,
  ...withAvatar(parseAvatarKey(r.avatar)),
});

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
       on conflict (username_key) do nothing returning id, username, avatar`,
      [username, usernameKey(username), passHash],
    );
    return r.rows[0] ? user(r.rows[0]) : null;
  }

  async findUser(username: string): Promise<StoredUser | null> {
    const r = await this.q('select id, username, avatar, pass_hash, recovery_hash from users where username_key = $1', [usernameKey(username)]);
    const row = r.rows[0];
    return row ? { ...user(row), passHash: row.pass_hash, recoveryHash: row.recovery_hash ?? null } : null;
  }

  async createSession(tokenHash: string, userId: string): Promise<void> {
    await this.q('insert into sessions (token_hash, user_id) values ($1, $2)', [tokenHash, userId]);
  }

  async sessionUser(tokenHash: string): Promise<User | null> {
    const r = await this.q('select u.id, u.username, u.avatar from sessions s join users u on u.id = s.user_id where s.token_hash = $1', [tokenHash]);
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
      `select u.id, u.username, u.avatar, f.accepted, f.requester = $1 as outgoing
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
      `insert into game_results (user_id, academy_id, score, place, won, players, played_at, kind, queue, side, rating_delta)
       select $1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10, $11 where exists (select 1 from users where id = $1)`,
      [r.userId, r.academyId, r.score, r.place, r.won, r.players, r.playedAt, r.kind ?? null, r.queue ?? null, r.side ?? null, r.ratingDelta ?? null],
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
      `select academy_id, score, place, won, players, played_at, kind, queue, side, rating_delta from game_results
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
      ...(row.kind ? { kind: row.kind } : {}),
      ...(row.queue ? { queue: row.queue } : {}),
      ...(row.side ? { side: row.side } : {}),
      ...(row.rating_delta !== null ? { ratingDelta: row.rating_delta } : {}),
    }));
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

  async setRecoveryHash(userId: string, hash: string | null): Promise<void> {
    await this.q('update users set recovery_hash = $2 where id = $1', [userId, hash]);
  }

  async addBlock(blocker: string, blocked: string): Promise<void> {
    await this.removeLink(blocker, blocked);
    await this.q(
      `insert into blocks (blocker, blocked) select $1, $2
       where exists (select 1 from users where id = $1) and exists (select 1 from users where id = $2)
       on conflict do nothing`,
      [blocker, blocked],
    );
  }

  async removeBlock(blocker: string, blocked: string): Promise<void> {
    await this.q('delete from blocks where blocker = $1 and blocked = $2', [blocker, blocked]);
  }

  async blocks(userId: string): Promise<User[]> {
    const r = await this.q(
      'select u.id, u.username from blocks b join users u on u.id = b.blocked where b.blocker = $1 order by b.created_at',
      [userId],
    );
    return r.rows.map(user);
  }

  async blockedEither(a: string, b: string): Promise<boolean> {
    const r = await this.q('select 1 from blocks where (blocker = $1 and blocked = $2) or (blocker = $2 and blocked = $1) limit 1', [a, b]);
    return r.rows.length > 0;
  }

  async addReport(r: Report): Promise<void> {
    await this.q(
      `insert into reports (reporter_id, reporter, target_id, target, reason, note, room_code, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
      [r.reporterId, r.reporter, r.targetId, r.target, r.reason, r.note, r.roomCode, r.at],
    );
  }

  async recentReports(limit: number): Promise<Report[]> {
    const r = await this.q(
      `select reporter_id, reporter, target_id, target, reason, note, room_code, created_at
       from reports order by created_at desc, id desc limit $1`,
      [limit],
    );
    return r.rows.map((row) => ({
      reporterId: row.reporter_id === null ? '' : String(row.reporter_id),
      reporter: row.reporter,
      targetId: row.target_id === null ? '' : String(row.target_id),
      target: row.target,
      reason: row.reason,
      note: row.note,
      roomCode: row.room_code,
      at: new Date(row.created_at).getTime(),
    }));
  }

  async setAvatar(userId: string, avatar: Avatar | null): Promise<void> {
    await this.q('update users set avatar = $2 where id = $1', [userId, avatar ? avatarKey(avatar) : null]);
  }

  async setCountry(userId: string, country: string | null): Promise<void> {
    await this.q('update users set country = $2 where id = $1', [userId, country]);
  }

  async account(userId: string): Promise<Account | null> {
    const r = await this.q('select id, username, avatar, country, created_at from users where id = $1', [userId]);
    const row = r.rows[0];
    return row ? { user: user(row), country: row.country ?? null, memberSince: new Date(row.created_at).getTime() } : null;
  }

  async ratings(queue: Queue, userIds: string[]): Promise<Map<string, RatingRow>> {
    const out = new Map<string, RatingRow>();
    if (!userIds.length) return out;
    const r = await this.q('select user_id, rating, games from ratings where queue = $1 and user_id = any($2::bigint[])', [queue, userIds]);
    for (const row of r.rows) out.set(String(row.user_id), { rating: row.rating, games: row.games });
    return out;
  }

  async addRating(userId: string, queue: Queue, delta: number): Promise<void> {
    await this.q(
      `insert into ratings (user_id, queue, rating, games)
       select $1, $2, $3::int + $4::int, 1 where exists (select 1 from users where id = $1)
       on conflict (user_id, queue) do update set rating = ratings.rating + $4::int, games = ratings.games + 1, updated_at = now()`,
      [userId, queue, START_RATING, delta],
    );
  }

  async leaderboard(queue: Queue, scope: BoardScope, search: string | null, limit: number): Promise<RankedRow[]> {
    const r = await this.q(
      `select * from (${RANKED}) x where ($4::text is null or position($4::text in x.username_key) > 0)
       order by x.rank, x.username_key limit $5`,
      [queue, ...scopeParams(scope), search, limit],
    );
    return r.rows.map((row) => ({ user: user(row), country: row.country ?? null, rating: row.rating, games: row.games, rank: row.rank }));
  }

  async rankOf(queue: Queue, userId: string, scope: BoardScope): Promise<number | null> {
    const r = await this.q(`select x.rank from (${RANKED}) x where x.id = $4`, [queue, ...scopeParams(scope), userId]);
    return r.rows[0]?.rank ?? null;
  }

  async profileStats(userId: string): Promise<ProfileStats> {
    const [kinds, academies, wins] = await Promise.all([
      this.q(
        `select count(*)::int as games, count(*) filter (where won)::int as wins,
                coalesce(sum(score), 0)::int as total, coalesce(max(score), 0)::int as best,
                count(*) filter (where kind = 'ranked')::int as r_games, count(*) filter (where kind = 'ranked' and won)::int as r_wins
         from game_results where user_id = $1`,
        [userId],
      ),
      this.q(
        `select academy_id, count(*)::int as games, count(*) filter (where won)::int as wins
         from game_results where user_id = $1 group by academy_id`,
        [userId],
      ),
      this.q('select won from game_results where user_id = $1 order by played_at, id', [userId]),
    ]);
    const k = kinds.rows[0];
    return {
      totals: { games: k.games, wins: k.wins, totalScore: k.total, bestScore: k.best, ...streaks(wins.rows.map((row) => row.won)) },
      byKind: { casual: { games: k.games - k.r_games, wins: k.wins - k.r_wins }, ranked: { games: k.r_games, wins: k.r_wins } },
      academies: sortAcademies(academies.rows.map((row) => ({ academyId: row.academy_id, games: row.games, wins: row.wins }))),
    };
  }
}
