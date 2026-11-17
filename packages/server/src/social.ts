import {
  continentOf,
  countriesIn,
  divisionOf,
  isCountry,
  LEADERBOARD_SIZE,
  MAX_PASSWORD,
  MIN_PASSWORD,
  normalizeRecoveryCode,
  PROFILE_HISTORY,
  QUEUES,
  START_RATING,
  USERNAME_RE,
  type Avatar,
  type ErrorCode,
  type FriendList,
  type LeaderRow,
  type Profile,
  type Queue,
  type ReportReason,
  type Scope,
  type SocialMessage,
} from '@arcane/protocol';
import { ratingDeltas } from './rating';
import type { Clock } from './clock';
import { hashPassword, hashToken, newRecoveryCode, newToken, verifyPassword } from './passwords';
import { isPushEndpoint, Push, type PushConfig } from './push';
import type { Conn } from './room';
import { usernameKey, withAvatar, type BoardScope, type GameRecord, type Store, type User } from './store';

export interface SocialOptions {
  /** The room code this connection is seated in, if any (for invites). */
  roomOf(conn: Conn): string | null;
  clock: Clock;
  /** Web Push (VAPID key + sender); push notifications are off without it. */
  push?: PushConfig | null;
  /** A user's avatar changed; these are their logged-in connections (rooms show the new one). */
  onAvatar?(conns: Conn[]): void;
}

/** Failed logins allowed per username inside the window before further tries are refused. */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 10 * 60_000;
/** Reports one account may send inside REPORT_WINDOW_MS. */
export const MAX_REPORTS = 10;
export const REPORT_WINDOW_MS = 60 * 60_000;

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
  friend_offline: 'That friend is offline and has notifications off',
  invite_no_room: 'Join or create a room first',
  busy: 'Still working on your last request',
  unavailable: 'Accounts are unavailable right now',
  wrong_password: 'Wrong password',
  bad_recovery: 'Wrong username or recovery code',
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
  /** Accounts blocked by each online user (loaded at login), so rooms and quick match can ask synchronously. */
  private blockedBy = new Map<string, Set<string>>();
  private dummyHash: Promise<string> | null = null;
  readonly push: Push;

  constructor(
    private readonly store: Store,
    private readonly opts: SocialOptions,
  ) {
    this.push = new Push(store, opts.push ?? null);
  }

  isOnline(userId: string): boolean {
    return (this.userConns.get(userId)?.size ?? 0) > 0;
  }

  userOf(conn: Conn): User | null {
    return this.connUser.get(conn)?.user ?? null;
  }

  /** True when the account logged in on `viewer` blocked `accountId`. */
  hasBlocked(viewer: Conn, accountId: string): boolean {
    const me = this.userOf(viewer);
    return !!me && !!this.blockedBy.get(me.id)?.has(accountId);
  }

  /** True when the accounts on these connections must be kept apart (either blocked the other). */
  apart(a: Conn, b: Conn): boolean {
    const ua = this.userOf(a);
    const ub = this.userOf(b);
    return !!ua && !!ub && (!!this.blockedBy.get(ua.id)?.has(ub.id) || !!this.blockedBy.get(ub.id)?.has(ua.id));
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
      case 'changePassword':
      case 'deleteAccount':
      case 'recover':
      case 'createRecoveryCode':
        // These hash a password: one at a time per connection.
        if (this.busy.has(conn)) return this.fail(conn, 'busy');
        this.busy.add(conn);
        try {
          if (msg.t === 'signup') return await this.signup(conn, msg.username, msg.password);
          if (msg.t === 'login') return await this.login(conn, msg.username, msg.password);
          if (msg.t === 'changePassword') return await this.changePassword(conn, msg.current, msg.next);
          if (msg.t === 'recover') return await this.recover(conn, msg.username, msg.code, msg.password);
          if (msg.t === 'createRecoveryCode') return await this.createRecoveryCode(conn, msg.password);
          return await this.deleteAccount(conn, msg.password);
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
    // Other players' profiles and the non-friend leaderboards are open to guests too.
    if (msg.t === 'profile') return this.sendProfile(conn, me, msg.username);
    if (msg.t === 'leaderboard') return this.sendLeaderboard(conn, me, msg.queue, msg.scope, msg.search);
    if (!me) return this.fail(conn, 'not_logged_in');
    switch (msg.t) {
      case 'setCountry':
        if (msg.country !== null && !isCountry(msg.country)) return this.fail(conn, 'bad_message');
        await this.store.setCountry(me.id, msg.country);
        return this.sendProfile(conn, me);
      case 'logoutAll':
        await this.store.deleteSessions(me.id);
        return this.endLogins(me.id);
    }
    if (msg.t === 'pushSubscribe') {
      if (this.push.enabled && isPushEndpoint(msg.sub.endpoint)) await this.store.addPushSub(me.id, msg.sub);
      return;
    }
    if (msg.t === 'pushUnsubscribe') return this.store.removePushSub(msg.endpoint, me.id);
    if (msg.t === 'setAvatar') return this.setAvatar(me, msg.avatar);
    const other = await this.store.findUser(msg.username);
    if (!other || other.id === me.id) return this.fail(conn, 'no_user');
    switch (msg.t) {
      case 'block':
        await this.store.addBlock(me.id, other.id);
        await this.refreshBlocks(me.id);
        break;
      case 'unblock':
        await this.store.removeBlock(me.id, other.id);
        return this.refreshBlocks(me.id);
      case 'report':
        return this.report(conn, me, other, msg.reason, msg.note);
    }
    const link = await this.store.link(me.id, other.id);
    switch (msg.t) {
      case 'friendRequest':
        // Blocked either way: nothing happens, and neither side sees a request.
        if (await this.store.blockedEither(me.id, other.id)) break;
        // They already asked me: asking back is agreeing.
        if (link && !link.accepted && link.from === other.id) await this.store.accept(other.id, me.id);
        else if (!link) {
          await this.store.addRequest(me.id, other.id);
          this.notify(other.id, { title: 'Friend request', body: `${me.username} wants to be your friend`, url: '/', tag: `friend-${me.username}` });
        }
        break;
      case 'friendAccept':
        if (link && !link.accepted && link.from === other.id) await this.store.accept(other.id, me.id);
        break;
      case 'friendRemove':
        if (link) await this.store.removeLink(me.id, other.id);
        break;
      case 'invite': {
        if (!link?.accepted) return this.fail(conn, 'not_friends');
        const code = this.opts.roomOf(conn);
        if (!code) return this.fail(conn, 'invite_no_room');
        const online = this.isOnline(other.id);
        for (const c of this.userConns.get(other.id) ?? []) c.send({ t: 'invite', from: me.username, code });
        // Also to their devices: the app may be in the background or closed.
        const pushed = this.push.notify(other.id, {
          title: `${me.username} invites you`,
          body: `Tap to join room ${code}`,
          url: `/?room=${encodeURIComponent(code)}`,
          tag: `invite-${code}`,
        });
        if (online) {
          pushed.catch((e: Error) => console.error('invite push failed:', e.message));
          return;
        }
        if ((await pushed) === 0) return this.fail(conn, 'friend_offline');
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
    await this.issueRecoveryCode(conn, user.id);
  }

  /** Forgot password: a right recovery code sets the new password, ends every login, logs in here, and gives a new code. */
  private async recover(conn: Conn, username: string, code: string, password: string): Promise<void> {
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return this.fail(conn, 'bad_password');
    const key = `recover:${usernameKey(username)}`;
    if (this.recentFailures(key) >= MAX_FAILURES) return this.fail(conn, 'too_many_attempts');
    const stored = USERNAME_RE.test(username) ? await this.store.findUser(username) : null;
    // Same cost whether or not the account (or its code) exists.
    const ok = await verifyPassword(normalizeRecoveryCode(code), stored?.recoveryHash ?? (await this.dummy()));
    if (!stored?.recoveryHash || !ok) {
      this.failures.set(key, [...(this.failures.get(key) ?? []), this.opts.clock.now()]);
      return this.fail(conn, 'bad_recovery');
    }
    this.failures.delete(key);
    // The used code dies with the old password; a new one is shown right away.
    await this.store.setRecoveryHash(stored.id, null);
    await this.store.setPassword(stored.id, await hashPassword(password));
    await this.store.deleteSessions(stored.id);
    this.endLogins(stored.id);
    await this.startSession(conn, { id: stored.id, username: stored.username });
    await this.issueRecoveryCode(conn, stored.id);
  }

  /** A new recovery code for my account (the old one stops working). */
  private async createRecoveryCode(conn: Conn, password: string): Promise<void> {
    const me = await this.checkPassword(conn, password);
    if (me) await this.issueRecoveryCode(conn, me.id);
  }

  /** Make, store (hashed) and show a recovery code; skipped when the connection already closed, so no unseen code replaces the old one. */
  private async issueRecoveryCode(conn: Conn, userId: string): Promise<void> {
    if (this.gone.has(conn) || this.userOf(conn)?.id !== userId) return;
    const code = newRecoveryCode();
    await this.store.setRecoveryHash(userId, await hashPassword(normalizeRecoveryCode(code)));
    conn.send({ t: 'recoveryCode', code });
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
    await this.startSession(conn, { id: stored.id, username: stored.username, ...withAvatar(stored.avatar) });
  }

  /** Check the logged-in user's password, counting failures like logins do. */
  private async checkPassword(conn: Conn, password: string): Promise<User | null> {
    const me = this.userOf(conn);
    if (!me) {
      this.fail(conn, 'not_logged_in');
      return null;
    }
    const key = usernameKey(me.username);
    if (this.recentFailures(key) >= MAX_FAILURES) {
      this.fail(conn, 'too_many_attempts');
      return null;
    }
    const stored = await this.store.findUser(me.username);
    if (!stored || stored.id !== me.id) {
      this.fail(conn, 'bad_session');
      return null;
    }
    if (!(await verifyPassword(password, stored.passHash))) {
      this.failures.set(key, [...(this.failures.get(key) ?? []), this.opts.clock.now()]);
      this.fail(conn, 'wrong_password');
      return null;
    }
    this.failures.delete(key);
    return me;
  }

  /** New password; every other login of the account ends, this one stays. */
  private async changePassword(conn: Conn, current: string, next: string): Promise<void> {
    if (!this.userOf(conn)) return this.fail(conn, 'not_logged_in');
    if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) return this.fail(conn, 'bad_password');
    const me = await this.checkPassword(conn, current);
    if (!me) return;
    const keep = this.connUser.get(conn)!.tokenHash;
    await this.store.setPassword(me.id, await hashPassword(next));
    await this.store.deleteSessions(me.id, keep);
    this.endLogins(me.id, keep);
    conn.send({ t: 'passwordChanged' });
  }

  /** Remove the account and everything tied to it; friends get their updated lists. */
  private async deleteAccount(conn: Conn, password: string): Promise<void> {
    const me = await this.checkPassword(conn, password);
    if (!me) return;
    const others = (await this.store.friendRows(me.id)).map((r) => r.other.id);
    await this.store.deleteUser(me.id);
    this.endLogins(me.id);
    await Promise.all(others.map((id) => this.pushFriends(id)));
  }

  /** Log out every connection of a user (except those on the kept login). */
  private endLogins(userId: string, keepTokenHash?: string): void {
    for (const [c, x] of [...this.connUser]) {
      if (x.user.id !== userId || x.tokenHash === keepTokenHash) continue;
      this.unbind(c);
      c.send({ t: 'account', username: null });
    }
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
    conn.send({ t: 'account', username: user.username, ...withAvatar(user.avatar), ...(token ? { token } : {}) });
    conn.send({ t: 'pushKey', key: this.push.publicKey });
    const [list, blocked] = await Promise.all([this.friendList(user.id), this.store.blocks(user.id)]);
    if (this.isOnline(user.id)) this.blockedBy.set(user.id, new Set(blocked.map((u) => u.id)));
    conn.send({ t: 'friends', list });
    conn.send({ t: 'blocked', list: blockNames(blocked) });
  }

  // ---------- blocks and reports ----------

  /** Reload whom a user blocked and tell every tab of theirs. */
  private async refreshBlocks(userId: string): Promise<void> {
    const blocked = await this.store.blocks(userId);
    if (!this.userConns.get(userId)?.size) return;
    this.blockedBy.set(userId, new Set(blocked.map((u) => u.id)));
    for (const c of this.userConns.get(userId) ?? []) c.send({ t: 'blocked', list: blockNames(blocked) });
  }

  /** Save a report (with the room the reporter is in) and log one line; the note stays out of the log. */
  private async report(conn: Conn, me: User, other: User, reason: ReportReason, note: string): Promise<void> {
    const now = this.opts.clock.now();
    const key = `report:${me.id}`;
    const recent = (this.failures.get(key) ?? []).filter((t) => t > now - REPORT_WINDOW_MS);
    if (recent.length >= MAX_REPORTS) return this.fail(conn, 'too_many_attempts');
    this.failures.set(key, [...recent, now]);
    const roomCode = this.opts.roomOf(conn);
    await this.store.addReport({ reporterId: me.id, reporter: me.username, targetId: other.id, target: other.username, reason, note, roomCode, at: now });
    console.log(`report: ${me.username} reported ${other.username} for ${reason}${roomCode ? ` in room ${roomCode}` : ''}`);
    conn.send({ t: 'reported', username: other.username });
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

  /** Save the avatar, then tell my tabs, my rooms and my online friends. */
  private async setAvatar(me: User, avatar: Avatar | null): Promise<void> {
    await this.store.setAvatar(me.id, avatar);
    const conns = [...(this.userConns.get(me.id) ?? [])];
    for (const c of conns) {
      const x = this.connUser.get(c)!;
      this.connUser.set(c, { ...x, user: { ...x.user, avatar } });
      c.send({ t: 'account', username: x.user.username, avatar });
    }
    this.opts.onAvatar?.(conns);
    const friends = (await this.store.friendRows(me.id)).filter((r) => r.accepted);
    await Promise.all(friends.map((r) => this.pushFriends(r.other.id)));
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
      this.blockedBy.delete(me.user.id);
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
      .map((r) => ({ username: r.other.username, online: this.isOnline(r.other.id), ...withAvatar(r.other.avatar) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || byName(a.username, b.username));
    const pending = (outgoing: boolean) =>
      rows
        .filter((r) => !r.accepted && r.outgoing === outgoing)
        .map((r) => r.other.username)
        .sort(byName);
    return { friends, incoming: pending(false), outgoing: pending(true) };
  }

  // ---------- stats ----------

  /** Games are saved one after another, so ratings read for one game already include the previous one. */
  private saving: Promise<void> = Promise.resolve();

  /** Save finished games (applying ratings to ranked ones); a failing database only loses the records, never the game. */
  recordResults(records: GameRecord[]): Promise<void> {
    this.saving = this.saving
      .then(() => this.saveGame(records))
      .catch((e: Error) => console.error('saving game results failed:', e.message));
    return this.saving;
  }

  /** Ranked (every record ranked in one queue, two or more accounts): pairwise Elo by place, kept with each record. */
  private async saveGame(records: GameRecord[]): Promise<void> {
    const queue = records[0]?.queue;
    if (queue && records.length >= 2 && records.every((r) => r.kind === 'ranked' && r.queue === queue)) {
      const now = await this.store.ratings(queue, records.map((r) => r.userId));
      const deltas = ratingDeltas(records.map((r) => ({ id: r.userId, rating: now.get(r.userId)?.rating ?? START_RATING, place: r.place })));
      records = records.map((r) => ({ ...r, ratingDelta: deltas.get(r.userId) ?? 0 }));
      await Promise.all(records.map((r) => this.store.addRating(r.userId, queue, r.ratingDelta ?? 0)));
    }
    await Promise.all(records.map((r) => this.store.recordResult(r)));
  }

  /** My profile (login needed) or another player's by username (read-only). */
  private async sendProfile(conn: Conn, me: User | null, username?: string): Promise<void> {
    let id: string;
    if (username === undefined) {
      if (!me) return this.fail(conn, 'not_logged_in');
      id = me.id;
    } else {
      const found = await this.store.findUser(username);
      if (!found) return this.fail(conn, 'no_user');
      id = found.id;
    }
    const profile = await this.profile(id, me?.id ?? null);
    if (!profile) return this.fail(conn, 'no_user');
    conn.send({ t: 'profile', profile });
  }

  async profile(userId: string, viewerId: string | null): Promise<Profile | null> {
    const acc = await this.store.account(userId);
    if (!acc) return null;
    const [stats, recent, ranked] = await Promise.all([
      this.store.profileStats(userId),
      this.store.history(userId, PROFILE_HISTORY),
      Promise.all(
        QUEUES.map(async (queue) => {
          const rating = (await this.store.ratings(queue, [userId])).get(userId)?.rating ?? null;
          const [rank, countryRank] =
            rating === null
              ? [null, null]
              : await Promise.all([
                  this.store.rankOf(queue, userId, {}),
                  acc.country ? this.store.rankOf(queue, userId, { countries: [acc.country] }) : null,
                ]);
          return { queue, rating, division: divisionOf(rating), rank, countryRank };
        }),
      ),
    ]);
    return {
      username: acc.user.username,
      ...withAvatar(acc.user.avatar),
      country: acc.country,
      memberSince: acc.memberSince,
      me: userId === viewerId,
      ranked,
      totals: stats.totals,
      byKind: stats.byKind,
      academies: stats.academies,
      recent: recent.map((r) => ({
        at: r.playedAt,
        kind: r.kind ?? 'casual',
        ...(r.queue ? { queue: r.queue } : {}),
        academyId: r.academyId,
        side: r.side ?? 'A',
        place: r.place,
        score: r.score,
        players: r.players,
        ...(r.ratingDelta !== undefined ? { ratingDelta: r.ratingDelta } : {}),
      })),
    };
  }

  /** Who a scope covers for this viewer; null when it covers nobody (continent/country without a country set). */
  private async boardScope(me: User | null, scope: Scope): Promise<BoardScope | null> {
    if (scope === 'global') return {};
    if (scope === 'friends') {
      if (!me) return null;
      const friends = (await this.store.friendRows(me.id)).filter((r) => r.accepted).map((r) => r.other.id);
      return { userIds: [me.id, ...friends] };
    }
    const country = me ? (await this.store.account(me.id))?.country : null;
    const continent = continentOf(country);
    if (!country || !continent) return null;
    return scope === 'country' ? { countries: [country] } : { countries: countriesIn(continent) };
  }

  /** The top rows of a queue in a scope (a search keeps the scope ranks), plus my own row when logged in. */
  async leaderboard(me: User | null, queue: Queue, scope: Scope, search?: string): Promise<{ rows: LeaderRow[]; me: LeaderRow | null }> {
    const s = await this.boardScope(me, scope);
    const found = s ? await this.store.leaderboard(queue, s, search ? usernameKey(search) : null, LEADERBOARD_SIZE) : [];
    const rows: LeaderRow[] = found.map((r) => ({
      rank: r.rank,
      username: r.user.username,
      country: r.country,
      ...withAvatar(r.user.avatar),
      division: divisionOf(r.rating),
      rating: r.rating,
      games: r.games,
    }));
    if (!me) return { rows, me: null };
    const [acc, mine] = await Promise.all([this.store.account(me.id), this.store.ratings(queue, [me.id])]);
    const rated = mine.get(me.id);
    const rank = rated && s ? await this.store.rankOf(queue, me.id, s) : null;
    return {
      rows,
      me: {
        rank,
        username: me.username,
        country: acc?.country ?? null,
        ...withAvatar(acc ? acc.user.avatar : me.avatar),
        division: divisionOf(rated?.rating ?? null),
        rating: rated?.rating ?? null,
        games: rated?.games ?? 0,
      },
    };
  }

  private async sendLeaderboard(conn: Conn, me: User | null, queue: Queue, scope: Scope, search?: string): Promise<void> {
    if (scope === 'friends' && !me) return this.fail(conn, 'not_logged_in');
    conn.send({ t: 'leaderboard', queue, scope, ...(await this.leaderboard(me, queue, scope, search)) });
  }

  private async pushFriends(userId: string): Promise<void> {
    if (!this.userConns.get(userId)?.size) return;
    const list = await this.friendList(userId);
    for (const c of this.userConns.get(userId) ?? []) c.send({ t: 'friends', list });
  }

  /** Fire-and-forget push; failures are only logged. */
  private notify(userId: string, payload: Parameters<Push['notify']>[1]): void {
    this.push.notify(userId, payload).catch((e: Error) => console.error('push failed:', e.message));
  }

  private fail(conn: Conn, code: ErrorCode): void {
    conn.send({ t: 'error', code, message: MESSAGES[code] ?? 'Something went wrong' });
  }
}

const blockNames = (users: User[]) => users.map((u) => u.username).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
