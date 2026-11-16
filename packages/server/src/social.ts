import { MAX_PASSWORD, MIN_PASSWORD, USERNAME_RE, type ErrorCode, type FriendList, type SocialMessage } from '@arcane/protocol';
import type { Clock } from './clock';
import { hashPassword, hashToken, newToken, verifyPassword } from './passwords';
import type { Conn } from './room';
import { usernameKey, type Store, type User } from './store';

export interface SocialOptions {
  /** The room code this connection is seated in, if any (for invites). */
  roomOf(conn: Conn): string | null;
  clock: Clock;
}

/** Failed logins allowed per username inside the window before further tries are refused. */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 10 * 60_000;

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  bad_username: 'Usernames are 3–20 letters, digits or _',
  bad_password: `Passwords are ${MIN_PASSWORD}–${MAX_PASSWORD} characters`,
  username_taken: 'That username is taken',
  bad_login: 'Wrong username or password',
  bad_session: 'Please log in again',
  too_many_attempts: 'Too many tries; wait a few minutes',
  not_logged_in: 'Log in first',
  no_user: 'No player with that username',
  not_friends: 'You are not friends yet',
  friend_offline: 'That friend is offline',
  invite_no_room: 'Join or create a room first',
  busy: 'Still working on your last request',
  unavailable: 'Accounts are unavailable right now',
};

/**
 * Accounts, friends, presence and invites.
 * A user is online while at least one logged-in connection is open; friends hear about changes.
 */
export class Social {
  private connUser = new Map<Conn, { user: User; tokenHash: string }>();
  private userConns = new Map<string, Set<Conn>>();
  private gone = new WeakSet<Conn>();
  private busy = new WeakSet<Conn>();
  private failures = new Map<string, number[]>();
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly store: Store,
    private readonly opts: SocialOptions,
  ) {}

  isOnline(userId: string): boolean {
    return (this.userConns.get(userId)?.size ?? 0) > 0;
  }

  userOf(conn: Conn): User | null {
    return this.connUser.get(conn)?.user ?? null;
  }

  /** Handle one message; a failing store answers 'unavailable' instead of throwing. */
  async handle(conn: Conn, msg: SocialMessage): Promise<void> {
    try {
      await this.dispatch(conn, msg);
    } catch (e) {
      console.error(`account request "${msg.t}" failed:`, (e as Error).message);
      this.fail(conn, 'unavailable');
    }
  }

  private async dispatch(conn: Conn, msg: SocialMessage): Promise<void> {
    switch (msg.t) {
      case 'signup':
      case 'login':
        if (this.busy.has(conn)) return this.fail(conn, 'busy');
        this.busy.add(conn);
        try {
          return await (msg.t === 'signup' ? this.signup(conn, msg.username, msg.password) : this.login(conn, msg.username, msg.password));
        } finally {
          this.busy.delete(conn);
        }
      case 'auth': {
        const tokenHash = hashToken(msg.token);
        const user = await this.store.sessionUser(tokenHash);
        if (this.gone.has(conn)) return;
        if (!user) return this.fail(conn, 'bad_session');
        return this.enter(conn, user, tokenHash);
      }
      case 'logout': {
        const me = this.connUser.get(conn);
        if (me) {
          // Every tab of this login shares the token, so all of them are logged out.
          await this.store.deleteSession(me.tokenHash);
          for (const [c, x] of [...this.connUser]) {
            if (x.tokenHash !== me.tokenHash) continue;
            this.unbind(c);
            c.send({ t: 'account', username: null });
          }
        } else conn.send({ t: 'account', username: null });
        return;
      }
    }
    const me = this.userOf(conn);
    if (!me) return this.fail(conn, 'not_logged_in');
    const other = await this.store.findUser(msg.username);
    if (!other || other.id === me.id) return this.fail(conn, 'no_user');
    const link = await this.store.link(me.id, other.id);
    switch (msg.t) {
      case 'friendRequest':
        // They already asked me: asking back is agreeing.
        if (link && !link.accepted && link.from === other.id) await this.store.accept(other.id, me.id);
        else if (!link) await this.store.addRequest(me.id, other.id);
        break;
      case 'friendAccept':
        if (link && !link.accepted && link.from === other.id) await this.store.accept(other.id, me.id);
        break;
      case 'friendRemove':
        if (link) await this.store.removeLink(me.id, other.id);
        break;
      case 'invite': {
        if (!link?.accepted) return this.fail(conn, 'not_friends');
        if (!this.isOnline(other.id)) return this.fail(conn, 'friend_offline');
        const code = this.opts.roomOf(conn);
        if (!code) return this.fail(conn, 'invite_no_room');
        for (const c of this.userConns.get(other.id) ?? []) c.send({ t: 'invite', from: me.username, code });
        return;
      }
    }
    await Promise.all([this.pushFriends(me.id), this.pushFriends(other.id)]);
  }

  /** The transport lost this connection. */
  onClose(conn: Conn): void {
    this.gone.add(conn);
    this.unbind(conn);
  }

  // ---------- accounts ----------

  private async signup(conn: Conn, username: string, password: string): Promise<void> {
    if (!USERNAME_RE.test(username)) return this.fail(conn, 'bad_username');
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return this.fail(conn, 'bad_password');
    const user = await this.store.createUser(username, await hashPassword(password));
    if (!user) return this.fail(conn, 'username_taken');
    await this.startSession(conn, user);
  }

  private async login(conn: Conn, username: string, password: string): Promise<void> {
    const key = usernameKey(username);
    if (this.recentFailures(key) >= MAX_FAILURES) return this.fail(conn, 'too_many_attempts');
    const stored = USERNAME_RE.test(username) ? await this.store.findUser(username) : null;
    // Unknown names cost the same time as wrong passwords, so timing does not reveal who exists.
    const ok = await verifyPassword(password, stored?.passHash ?? (await this.dummy()));
    if (!stored || !ok) {
      this.failures.set(key, [...(this.failures.get(key) ?? []), this.opts.clock.now()]);
      return this.fail(conn, 'bad_login');
    }
    this.failures.delete(key);
    await this.startSession(conn, { id: stored.id, username: stored.username });
  }

  private async startSession(conn: Conn, user: User): Promise<void> {
    const token = newToken();
    const tokenHash = hashToken(token);
    await this.store.createSession(tokenHash, user.id);
    if (this.gone.has(conn)) return;
    await this.enter(conn, user, tokenHash, token);
  }

  private async enter(conn: Conn, user: User, tokenHash: string, token?: string): Promise<void> {
    this.bind(conn, user, tokenHash);
    conn.send({ t: 'account', username: user.username, ...(token ? { token } : {}) });
    conn.send({ t: 'friends', list: await this.friendList(user.id) });
  }

  private recentFailures(key: string): number {
    const since = this.opts.clock.now() - FAILURE_WINDOW_MS;
    const recent = (this.failures.get(key) ?? []).filter((t) => t > since);
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent.length;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password');
    return this.dummyHash;
  }

  // ---------- presence ----------

  private bind(conn: Conn, user: User, tokenHash: string): void {
    if (this.connUser.get(conn)?.user.id !== user.id) this.unbind(conn);
    this.connUser.set(conn, { user, tokenHash });
    const set = this.userConns.get(user.id) ?? new Set<Conn>();
    const wasOnline = set.size > 0;
    set.add(conn);
    this.userConns.set(user.id, set);
    if (!wasOnline) this.announce(user, true);
  }

  private unbind(conn: Conn): void {
    const me = this.connUser.get(conn);
    if (!me) return;
    this.connUser.delete(conn);
    const set = this.userConns.get(me.user.id);
    set?.delete(conn);
    if (set && set.size === 0) {
      this.userConns.delete(me.user.id);
      this.announce(me.user, false);
    }
  }

  /** Tell online friends that `user` came online or left. */
  private announce(user: User, online: boolean): void {
    void this.store
      .friendRows(user.id)
      .then((rows) => {
        // Presence may have flipped again while the query ran; only send what is still true.
        if (this.isOnline(user.id) !== online) return;
        for (const r of rows) {
          if (!r.accepted) continue;
          for (const c of this.userConns.get(r.other.id) ?? []) c.send({ t: 'presence', username: user.username, online });
        }
      })
      .catch((e: Error) => console.error('presence update failed:', e.message));
  }

  // ---------- friends ----------

  async friendList(userId: string): Promise<FriendList> {
    const rows = await this.store.friendRows(userId);
    const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
    const friends = rows
      .filter((r) => r.accepted)
      .map((r) => ({ username: r.other.username, online: this.isOnline(r.other.id) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || byName(a.username, b.username));
    const pending = (outgoing: boolean) =>
      rows
        .filter((r) => !r.accepted && r.outgoing === outgoing)
        .map((r) => r.other.username)
        .sort(byName);
    return { friends, incoming: pending(false), outgoing: pending(true) };
  }

  private async pushFriends(userId: string): Promise<void> {
    if (!this.userConns.get(userId)?.size) return;
    const list = await this.friendList(userId);
    for (const c of this.userConns.get(userId) ?? []) c.send({ t: 'friends', list });
  }

  private fail(conn: Conn, code: ErrorCode): void {
    conn.send({ t: 'error', code, message: MESSAGES[code] ?? 'Something went wrong' });
  }
}
