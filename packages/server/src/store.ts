import type { Avatar, PushSub } from '@arcane/protocol';

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
  /** 1 = first; players with equal score and coins share a place. */
  place: number;
  /** One of the winners (shared wins count). */
  won: boolean;
  /** Seats in the game (humans and bots). */
  players: number;
  /** Epoch ms. */
  playedAt: number;
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
  /** Null resets to the default avatar. */
  setAvatar(userId: string, avatar: Avatar | null): Promise<void>;
}

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
  private nextId = 1;

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createUser(username: string, passHash: string): Promise<User | null> {
    const key = usernameKey(username);
    if (this.byKey.has(key)) return null;
    const u: StoredUser = { id: String(this.nextId++), username, passHash };
    this.users.set(u.id, u);
    this.byKey.set(key, u.id);
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

  async setAvatar(userId: string, avatar: Avatar | null): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.avatar = avatar ? { ...avatar } : null;
  }
}
