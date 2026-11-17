import { START_RATING, type Avatar, type GameKind, type PushSub, type Queue, type ReportReason, type Side } from '@arcane/protocol';
import { streaks } from './rating';

/**
 * Where accounts, login sessions and friendships live.
 * Two implementations share this interface: Postgres (when DATABASE_URL is set) and memory (dev, tests).
 */

export interface User {
  id: string;
  /** As the player typed it at signup. */
  username: string;
  /** Chosen emblem; null or absent = the default. */
  avatar?: Avatar | null;
}

export interface StoredUser extends User {
  passHash: string;
  /** scrypt hash of the recovery code; null when the account has none. */
  recoveryHash: string | null;
}

/** A player's report about another account. Names are kept so the row still reads after an account is deleted. */
export interface Report {
  reporterId: string;
  reporter: string;
  targetId: string;
  target: string;
  reason: ReportReason;
  note: string;
  /** The room the reporter was in, if any. */
  roomCode: string | null;
  /** Epoch ms. */
  at: number;
}

/** One friendship row: `from` asked `to`; accepted once `to` agreed. */
export interface FriendLink {
  from: string;
  to: string;
  accepted: boolean;
}

export interface FriendRow {
  other: User;
  accepted: boolean;
  /** True when I sent the (still pending) request. */
  outgoing: boolean;
}

/** One finished game, as seen by one account that played it. */
export interface GameRecord {
  userId: string;
  academyId: string;
  score: number;
  /** 1 = first. Ranked: equal score shares a place and leavers share last; other games split equal score by coins. */
  place: number;
  /** One of the winners (shared wins count). */
  won: boolean;
  /** Seats in the game (humans and bots). */
  players: number;
  /** Epoch ms. */
  playedAt: number;
  /** What kind of game; absent on old records (read as casual). */
  kind?: GameKind;
  /** Casual and ranked queue games. */
  queue?: Queue;
  /** The table's academy side. */
  side?: Side;
  /** Ranked games with AI opponents: their places and rating offsets (rated against, never stored). */
  aiRivals?: { place: number; offset: number }[];
  /** Ranked games: the rating change this game made (set when ratings are applied). */
  ratingDelta?: number;
}

/** Account details shown on a profile. */
export interface Account {
  user: User;
  /** ISO 3166-1 alpha-2, or null when not set. */
  country: string | null;
  /** Epoch ms of signup. */
  memberSince: number;
}

export interface RatingRow {
  rating: number;
  /** Ranked games played in this queue. */
  games: number;
}

/** Who a leaderboard covers: given ids only, given countries only, or (empty) everyone. */
export interface BoardScope {
  userIds?: string[];
  countries?: string[];
}

export interface RankedRow {
  user: User;
  country: string | null;
  rating: number;
  games: number;
  /** 1 = best in the scope; equal ratings share a rank. */
  rank: number;
}

export interface WinCount {
  games: number;
  wins: number;
}

export interface ProfileStats {
  totals: StatTotals & { streak: number; bestStreak: number };
  /** Everything not ranked (bots, rooms, casual queues, old records) is casual. */
  byKind: { casual: WinCount; ranked: WinCount };
  /** Most played first. */
  academies: (WinCount & { academyId: string })[];
}

export interface StatTotals {
  games: number;
  wins: number;
  totalScore: number;
  bestScore: number;
}

export const NO_STATS: StatTotals = { games: 0, wins: 0, totalScore: 0, bestScore: 0 };

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  /** Null when the username (ignoring case) is taken. */
  createUser(username: string, passHash: string): Promise<User | null>;
  findUser(username: string): Promise<StoredUser | null>;
  /** Sessions are kept by the SHA-256 of their token, never the token itself. */
  createSession(tokenHash: string, userId: string): Promise<void>;
  sessionUser(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** The link between two users in either direction, if any. */
  link(a: string, b: string): Promise<FriendLink | null>;
  addRequest(from: string, to: string): Promise<void>;
  accept(from: string, to: string): Promise<void>;
  /** Remove the link between two users, whichever direction it was. */
  removeLink(a: string, b: string): Promise<void>;
  friendRows(userId: string): Promise<FriendRow[]>;
  setPassword(userId: string, passHash: string): Promise<void>;
  /** End every login of a user, except the one kept by `keepTokenHash`. */
  deleteSessions(userId: string, keepTokenHash?: string): Promise<void>;
  /** Remove the user with their sessions, friendships and game results. */
  deleteUser(userId: string): Promise<void>;
  /** Ignored when the user no longer exists. */
  recordResult(r: GameRecord): Promise<void>;
  /** Totals per user id; users with no games get zeros. */
  totals(userIds: string[]): Promise<Map<string, StatTotals>>;
  /** Newest first. */
  history(userId: string, limit: number): Promise<GameRecord[]>;
  /** Save a device's push subscription for a user (an endpoint belongs to one user; the latest wins). */
  addPushSub(userId: string, sub: PushSub): Promise<void>;
  pushSubs(userId: string): Promise<PushSub[]>;
  /** Forget a subscription; with `userId`, only if it is that user's. */
  removePushSub(endpoint: string, userId?: string): Promise<void>;
  /** Replace the user's recovery code hash (null removes it). */
  setRecoveryHash(userId: string, hash: string | null): Promise<void>;
  /** `blocker` blocks `blocked` (repeating is harmless); any friendship between them is removed. */
  addBlock(blocker: string, blocked: string): Promise<void>;
  removeBlock(blocker: string, blocked: string): Promise<void>;
  /** The accounts this user blocked. */
  blocks(userId: string): Promise<User[]>;
  /** True when either user blocked the other. */
  blockedEither(a: string, b: string): Promise<boolean>;
  addReport(r: Report): Promise<void>;
  /** Newest first. */
  recentReports(limit: number): Promise<Report[]>;
  /** Null resets to the default avatar. */
  setAvatar(userId: string, avatar: Avatar | null): Promise<void>;
  /** ISO country code (checked by the caller), or null to clear. */
  setCountry(userId: string, country: string | null): Promise<void>;
  account(userId: string): Promise<Account | null>;
  /** Ratings in one queue for the users that have played it. */
  ratings(queue: Queue, userIds: string[]): Promise<Map<string, RatingRow>>;
  /** Add one ranked game's change (starting from START_RATING); ignored when the user no longer exists. */
  addRating(userId: string, queue: Queue, delta: number): Promise<void>;
  /** Rated players in the scope, best first; `search` (lower case) filters usernames but keeps the scope ranks. */
  leaderboard(queue: Queue, scope: BoardScope, search: string | null, limit: number): Promise<RankedRow[]>;
  /** The user's rank in the scope, or null when unrated there. */
  rankOf(queue: Queue, userId: string, scope: BoardScope): Promise<number | null>;
  profileStats(userId: string): Promise<ProfileStats>;
}

export const sortAcademies = <T extends WinCount & { academyId: string }>(rows: T[]) =>
  rows.sort((a, b) => b.games - a.games || b.wins - a.wins || a.academyId.localeCompare(b.academyId));

/** Devices kept per user; the oldest is dropped beyond this. */
export const MAX_PUSH_SUBS = 10;

export const usernameKey = (u: string) => u.toLowerCase();

/** Users carry an avatar only once one is chosen. */
export const withAvatar = (a: Avatar | null | undefined): { avatar?: Avatar } => (a ? { avatar: a } : {});

export class MemoryStore implements Store {
  private users = new Map<string, StoredUser>();
  private byKey = new Map<string, string>();
  private sessions = new Map<string, string>();
  private links: FriendLink[] = [];
  private results: GameRecord[] = [];
  /** By endpoint, in insertion order (oldest first). */
  private push = new Map<string, { userId: string; sub: PushSub }>();
  private blockRows: { blocker: string; blocked: string }[] = [];
  private reports: Report[] = [];
  private extra = new Map<string, { country: string | null; createdAt: number }>();
  /** `${userId}|${queue}` → rating. */
  private ratingRows = new Map<string, RatingRow & { userId: string; queue: Queue }>();
  private nextId = 1;

  constructor(private readonly now: () => number = Date.now) {}

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createUser(username: string, passHash: string): Promise<User | null> {
    const key = usernameKey(username);
    if (this.byKey.has(key)) return null;
    const u: StoredUser = { id: String(this.nextId++), username, passHash, recoveryHash: null };
    this.users.set(u.id, u);
    this.byKey.set(key, u.id);
    this.extra.set(u.id, { country: null, createdAt: this.now() });
    return { id: u.id, username };
  }

  async findUser(username: string): Promise<StoredUser | null> {
    const id = this.byKey.get(usernameKey(username));
    return id ? { ...this.users.get(id)! } : null;
  }

  async createSession(tokenHash: string, userId: string): Promise<void> {
    this.sessions.set(tokenHash, userId);
  }

  async sessionUser(tokenHash: string): Promise<User | null> {
    const id = this.sessions.get(tokenHash);
    const u = id ? this.users.get(id) : undefined;
    return u ? { id: u.id, username: u.username, ...withAvatar(u.avatar) } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async link(a: string, b: string): Promise<FriendLink | null> {
    const l = this.links.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    return l ? { ...l } : null;
  }

  async addRequest(from: string, to: string): Promise<void> {
    if (!(await this.link(from, to))) this.links.push({ from, to, accepted: false });
  }

  async accept(from: string, to: string): Promise<void> {
    const l = this.links.find((x) => x.from === from && x.to === to);
    if (l) l.accepted = true;
  }

  async removeLink(a: string, b: string): Promise<void> {
    this.links = this.links.filter((x) => !((x.from === a && x.to === b) || (x.from === b && x.to === a)));
  }

  async friendRows(userId: string): Promise<FriendRow[]> {
    const rows: FriendRow[] = [];
    for (const l of this.links) {
      if (l.from !== userId && l.to !== userId) continue;
      const other = this.users.get(l.from === userId ? l.to : l.from)!;
      rows.push({ other: { id: other.id, username: other.username, ...withAvatar(other.avatar) }, accepted: l.accepted, outgoing: l.from === userId });
    }
    return rows;
  }

  async setPassword(userId: string, passHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.passHash = passHash;
  }

  async deleteSessions(userId: string, keepTokenHash?: string): Promise<void> {
    for (const [h, id] of this.sessions) if (id === userId && h !== keepTokenHash) this.sessions.delete(h);
  }

  async deleteUser(userId: string): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    this.users.delete(userId);
    this.byKey.delete(usernameKey(u.username));
    await this.deleteSessions(userId);
    this.links = this.links.filter((x) => x.from !== userId && x.to !== userId);
    this.results = this.results.filter((r) => r.userId !== userId);
    for (const [e, x] of this.push) if (x.userId === userId) this.push.delete(e);
    this.blockRows = this.blockRows.filter((b) => b.blocker !== userId && b.blocked !== userId);
    this.extra.delete(userId);
    for (const [k, r] of this.ratingRows) if (r.userId === userId) this.ratingRows.delete(k);
  }

  async recordResult(r: GameRecord): Promise<void> {
    if (this.users.has(r.userId)) this.results.push({ ...r });
  }

  async totals(userIds: string[]): Promise<Map<string, StatTotals>> {
    const out = new Map<string, StatTotals>(userIds.map((id) => [id, { ...NO_STATS }]));
    for (const r of this.results) {
      const t = out.get(r.userId);
      if (!t) continue;
      t.games++;
      if (r.won) t.wins++;
      t.totalScore += r.score;
      t.bestScore = t.games === 1 ? r.score : Math.max(t.bestScore, r.score);
    }
    return out;
  }

  async history(userId: string, limit: number): Promise<GameRecord[]> {
    return this.results
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.userId === userId)
      .sort((a, b) => b.r.playedAt - a.r.playedAt || b.i - a.i)
      .slice(0, limit)
      .map((x) => ({ ...x.r }));
  }

  async addPushSub(userId: string, sub: PushSub): Promise<void> {
    this.push.delete(sub.endpoint);
    this.push.set(sub.endpoint, { userId, sub: { endpoint: sub.endpoint, keys: { ...sub.keys } } });
    const mine = [...this.push.values()].filter((x) => x.userId === userId);
    for (const x of mine.slice(0, Math.max(0, mine.length - MAX_PUSH_SUBS))) this.push.delete(x.sub.endpoint);
  }

  async pushSubs(userId: string): Promise<PushSub[]> {
    return [...this.push.values()].filter((x) => x.userId === userId).map((x) => ({ endpoint: x.sub.endpoint, keys: { ...x.sub.keys } }));
  }

  async removePushSub(endpoint: string, userId?: string): Promise<void> {
    const x = this.push.get(endpoint);
    if (x && (userId === undefined || x.userId === userId)) this.push.delete(endpoint);
  }

  async setRecoveryHash(userId: string, hash: string | null): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.recoveryHash = hash;
  }

  async addBlock(blocker: string, blocked: string): Promise<void> {
    if (!this.users.has(blocker) || !this.users.has(blocked)) return;
    await this.removeLink(blocker, blocked);
    if (!this.blockRows.some((b) => b.blocker === blocker && b.blocked === blocked)) this.blockRows.push({ blocker, blocked });
  }

  async removeBlock(blocker: string, blocked: string): Promise<void> {
    this.blockRows = this.blockRows.filter((b) => !(b.blocker === blocker && b.blocked === blocked));
  }

  async blocks(userId: string): Promise<User[]> {
    return this.blockRows
      .filter((b) => b.blocker === userId)
      .map((b) => this.users.get(b.blocked)!)
      .map((u) => ({ id: u.id, username: u.username }));
  }

  async blockedEither(a: string, b: string): Promise<boolean> {
    return this.blockRows.some((x) => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a));
  }

  async addReport(r: Report): Promise<void> {
    this.reports.push({ ...r });
  }

  async recentReports(limit: number): Promise<Report[]> {
    return this.reports
      .slice()
      .reverse()
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async setAvatar(userId: string, avatar: Avatar | null): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.avatar = avatar ? { ...avatar } : null;
  }

  async setCountry(userId: string, country: string | null): Promise<void> {
    const x = this.extra.get(userId);
    if (x) x.country = country;
  }

  async account(userId: string): Promise<Account | null> {
    const u = this.users.get(userId);
    const x = this.extra.get(userId);
    return u && x ? { user: this.pub(u), country: x.country, memberSince: x.createdAt } : null;
  }

  async ratings(queue: Queue, userIds: string[]): Promise<Map<string, RatingRow>> {
    const out = new Map<string, RatingRow>();
    for (const id of userIds) {
      const r = this.ratingRows.get(`${id}|${queue}`);
      if (r) out.set(id, { rating: r.rating, games: r.games });
    }
    return out;
  }

  async addRating(userId: string, queue: Queue, delta: number): Promise<void> {
    if (!this.users.has(userId)) return;
    const k = `${userId}|${queue}`;
    const r = this.ratingRows.get(k) ?? { userId, queue, rating: START_RATING, games: 0 };
    this.ratingRows.set(k, { ...r, rating: r.rating + delta, games: r.games + 1 });
  }

  /** Every rated user in the scope with their rank (rank() semantics: ties share, gaps follow). */
  private ranked(queue: Queue, scope: BoardScope): RankedRow[] {
    const rows = [...this.ratingRows.values()]
      .filter((r) => r.queue === queue)
      .filter((r) => !scope.userIds || scope.userIds.includes(r.userId))
      .map((r) => ({ r, x: this.extra.get(r.userId)!, u: this.users.get(r.userId)! }))
      .filter(({ x }) => !scope.countries || (x.country !== null && scope.countries.includes(x.country)))
      .sort((a, b) => b.r.rating - a.r.rating || usernameKey(a.u.username).localeCompare(usernameKey(b.u.username)));
    return rows.map(({ r, x, u }) => ({
      user: this.pub(u),
      country: x.country,
      rating: r.rating,
      games: r.games,
      rank: 1 + rows.filter((o) => o.r.rating > r.rating).length,
    }));
  }

  async leaderboard(queue: Queue, scope: BoardScope, search: string | null, limit: number): Promise<RankedRow[]> {
    return this.ranked(queue, scope)
      .filter((r) => !search || usernameKey(r.user.username).includes(search))
      .slice(0, limit);
  }

  async rankOf(queue: Queue, userId: string, scope: BoardScope): Promise<number | null> {
    return this.ranked(queue, scope).find((r) => r.user.id === userId)?.rank ?? null;
  }

  async profileStats(userId: string): Promise<ProfileStats> {
    const mine = this.results
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.userId === userId)
      .sort((a, b) => a.r.playedAt - b.r.playedAt || a.i - b.i)
      .map((x) => x.r);
    const totals = (await this.totals([userId])).get(userId)!;
    const count = (rs: GameRecord[]): WinCount => ({ games: rs.length, wins: rs.filter((r) => r.won).length });
    const ids = [...new Set(mine.map((r) => r.academyId))];
    return {
      totals: { ...totals, ...streaks(mine.map((r) => r.won)) },
      byKind: { casual: count(mine.filter((r) => r.kind !== 'ranked')), ranked: count(mine.filter((r) => r.kind === 'ranked')) },
      academies: sortAcademies(ids.map((academyId) => ({ academyId, ...count(mine.filter((r) => r.academyId === academyId)) }))),
    };
  }

  private pub(u: StoredUser): User {
    return { id: u.id, username: u.username, ...withAvatar(u.avatar) };
  }
}
