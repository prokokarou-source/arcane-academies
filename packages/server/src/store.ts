/**
 * Where accounts, login sessions and friendships live.
 * Two implementations share this interface: Postgres (when DATABASE_URL is set) and memory (dev, tests).
 */

export interface User {
  id: string;
  /** As the player typed it at signup. */
  username: string;
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
}

export const usernameKey = (u: string) => u.toLowerCase();

export class MemoryStore implements Store {
  private users = new Map<string, StoredUser>();
  private byKey = new Map<string, string>();
  private sessions = new Map<string, string>();
  private links: FriendLink[] = [];
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
    return u ? { id: u.id, username: u.username } : null;
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
      rows.push({ other: { id: other.id, username: other.username }, accepted: l.accepted, outgoing: l.from === userId });
    }
    return rows;
  }
}
