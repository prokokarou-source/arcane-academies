import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECOVERY_ALPHABET, type SocialMessage } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { RoomManager } from '../src/manager';
import { FAILURE_WINDOW_MS, MAX_FAILURES, MAX_REPORTS, Social } from '../src/social';
import { MemoryStore } from '../src/store';
import type { Conn } from '../src/room';
import { FakeConn, lobbyWith } from './fakes';

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const store = new MemoryStore();
  const clock = new ManualClock(1_000_000);
  const rooms = new Map<Conn, string>();
  const social = new Social(store, { roomOf: (c) => rooms.get(c) ?? null, clock });
  const send = async (c: FakeConn, m: SocialMessage) => {
    await social.handle(c, m);
    await settle();
  };
  const signup = async (username: string) => {
    const c = new FakeConn(username);
    await send(c, { t: 'signup', username, password: 'secret1' });
    return c;
  };
  const friends = async () => {
    const a = await signup('Ana');
    const b = await signup('Bob');
    await send(a, { t: 'friendRequest', username: 'Bob' });
    await send(b, { t: 'friendAccept', username: 'Ana' });
    return { a, b };
  };
  return { store, clock, rooms, social, send, signup, friends };
}

afterEach(() => vi.restoreAllMocks());

describe('blocking', () => {
  it('ends the friendship, lists the blocked account, and survives a new login', async () => {
    const { send, friends, social } = setup();
    const { a, b } = await friends();
    expect(a.last('blocked')).toEqual({ t: 'blocked', list: [] });
    await send(a, { t: 'block', username: 'bob' });
    expect(a.last('blocked')).toEqual({ t: 'blocked', list: ['Bob'] });
    expect(a.last('friends')!.list.friends).toEqual([]);
    expect(b.last('friends')!.list.friends).toEqual([]);
    expect(social.hasBlocked(a, social.userOf(b)!.id)).toBe(true);
    expect(social.hasBlocked(b, social.userOf(a)!.id)).toBe(false);
    expect(social.apart(a, b)).toBe(true);
    expect(social.apart(b, a)).toBe(true);
    const again = new FakeConn();
    await send(again, { t: 'login', username: 'Ana', password: 'secret1' });
    expect(again.last('blocked')!.list).toEqual(['Bob']);
  });

  it('hides friend requests both ways and refuses invites', async () => {
    const { send, signup, rooms } = setup();
    const a = await signup('Ana');
    const b = await signup('Bob');
    await send(a, { t: 'friendRequest', username: 'Bob' });
    await send(b, { t: 'block', username: 'Ana' });
    // The pending request is gone, and new ones in either direction do nothing.
    expect(b.last('friends')!.list.incoming).toEqual([]);
    await send(a, { t: 'friendRequest', username: 'Bob' });
    await send(b, { t: 'friendRequest', username: 'Ana' });
    expect(a.last('friends')!.list).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(b.last('friends')!.list).toEqual({ friends: [], incoming: [], outgoing: [] });
    rooms.set(a, 'WAND-42');
    await send(a, { t: 'invite', username: 'Bob' });
    expect(a.lastError()).toBe('not_friends');
    expect(b.last('invite')).toBeUndefined();
  });

  it('unblocks, after which requests work again', async () => {
    const { send, signup, social } = setup();
    const a = await signup('Ana');
    const b = await signup('Bob');
    await send(a, { t: 'block', username: 'Bob' });
    await send(a, { t: 'unblock', username: 'Bob' });
    expect(a.last('blocked')!.list).toEqual([]);
    expect(social.apart(a, b)).toBe(false);
    await send(b, { t: 'friendRequest', username: 'Ana' });
    expect(a.last('friends')!.list.incoming).toEqual(['Bob']);
  });

  it('needs a login and an existing other account', async () => {
    const { send, signup } = setup();
    const guest = new FakeConn();
    await send(guest, { t: 'block', username: 'Bob' });
    expect(guest.lastError()).toBe('not_logged_in');
    const a = await signup('Ana');
    await send(a, { t: 'block', username: 'Ana' });
    expect(a.lastError()).toBe('no_user');
    await send(a, { t: 'block', username: 'Nobody' });
    expect(a.lastError()).toBe('no_user');
  });
});

describe('reports', () => {
  it('stores reporter, target, reason, note and room, and logs one line without the note', async () => {
    const { send, signup, store, rooms, clock } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = await signup('Ana');
    await signup('Bob');
    rooms.set(a, 'WAND-42');
    await send(a, { t: 'report', username: 'bob', reason: 'harassment', note: 'secret details' });
    expect(a.last('reported')).toEqual({ t: 'reported', username: 'Bob' });
    expect(await store.recentReports(5)).toEqual([
      expect.objectContaining({ reporter: 'Ana', target: 'Bob', reason: 'harassment', note: 'secret details', roomCode: 'WAND-42', at: clock.now() }),
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe('report: Ana reported Bob for harassment in room WAND-42');
  });

  it('limits how many reports one account sends per hour', async () => {
    const { send, signup, clock } = setup();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = await signup('Ana');
    await signup('Bob');
    for (let i = 0; i < MAX_REPORTS; i++) await send(a, { t: 'report', username: 'Bob', reason: 'other', note: '' });
    expect(a.lastError()).toBeUndefined();
    await send(a, { t: 'report', username: 'Bob', reason: 'other', note: '' });
    expect(a.lastError()).toBe('too_many_attempts');
    clock.advance(60 * 60_000 + 1);
    a.sent = [];
    await send(a, { t: 'report', username: 'Bob', reason: 'other', note: '' });
    expect(a.last('reported')).toBeDefined();
  });
});

describe('recovery codes', () => {
  const codeRe = new RegExp(`^([${RECOVERY_ALPHABET}]{4}-){3}[${RECOVERY_ALPHABET}]{4}$`);

  it('shows a code once at signup and stores only its hash', async () => {
    const { signup, store } = setup();
    const a = await signup('Ana');
    const code = a.last('recoveryCode')!.code;
    expect(code).toMatch(codeRe);
    const stored = (await store.findUser('Ana'))!;
    expect(stored.recoveryHash).toMatch(/^scrypt\$/);
    expect(stored.recoveryHash).not.toContain(code.replace(/-/g, ''));
    expect((await signup('Bob')).last('recoveryCode')!.code).not.toBe(code);
  });

  it('sets a new password, ends every other login, logs in, and gives a new code', async () => {
    const { signup, send } = setup();
    const a = await signup('Ana');
    const code = a.last('recoveryCode')!.code;
    const token = a.last('account')!.token!;
    const phone = new FakeConn();
    // Lower case and spaces are fine.
    await send(phone, { t: 'recover', username: 'ana', code: code.toLowerCase().replace(/-/g, ' '), password: 'brandnew' });
    expect(phone.last('account')).toMatchObject({ username: 'Ana', token: expect.any(String) });
    const next = phone.last('recoveryCode')!.code;
    expect(next).toMatch(codeRe);
    expect(next).not.toBe(code);
    expect(a.last('account')).toEqual({ t: 'account', username: null });
    const old = new FakeConn();
    await send(old, { t: 'auth', token });
    expect(old.lastError()).toBe('bad_session');
    await send(old, { t: 'login', username: 'Ana', password: 'secret1' });
    expect(old.lastError()).toBe('bad_login');
    await send(old, { t: 'login', username: 'Ana', password: 'brandnew' });
    expect(old.last('account')!.username).toBe('Ana');
    // The used code is spent.
    const again = new FakeConn();
    await send(again, { t: 'recover', username: 'Ana', code, password: 'another1' });
    expect(again.lastError()).toBe('bad_recovery');
  });

  it('refuses wrong codes, unknown names and short passwords, and rate-limits tries', async () => {
    const { signup, send, clock } = setup();
    const a = await signup('Ana');
    const code = a.last('recoveryCode')!.code;
    const c = new FakeConn();
    await send(c, { t: 'recover', username: 'Ana', code, password: '123' });
    expect(c.lastError()).toBe('bad_password');
    await send(c, { t: 'recover', username: 'Nobody', code, password: 'brandnew' });
    expect(c.lastError()).toBe('bad_recovery');
    for (let i = 0; i < MAX_FAILURES; i++) await send(c, { t: 'recover', username: 'Ana', code: 'AAAA-AAAA-AAAA-AAAA', password: 'brandnew' });
    await send(c, { t: 'recover', username: 'Ana', code, password: 'brandnew' });
    expect(c.lastError()).toBe('too_many_attempts');
    // Recovery failures do not lock out normal logins.
    const d = new FakeConn();
    await send(d, { t: 'login', username: 'Ana', password: 'secret1' });
    expect(d.last('account')!.username).toBe('Ana');
    clock.advance(FAILURE_WINDOW_MS + 1);
    await send(c, { t: 'recover', username: 'Ana', code, password: 'brandnew' });
    expect(c.last('account')!.username).toBe('Ana');
  });

  it('lets an existing account make a new code with its password', async () => {
    const { signup, send, store } = setup();
    const a = await signup('Ana');
    const first = a.last('recoveryCode')!.code;
    await store.setRecoveryHash((await store.findUser('Ana'))!.id, null);
    await send(a, { t: 'createRecoveryCode', password: 'nope' });
    expect(a.lastError()).toBe('wrong_password');
    await send(a, { t: 'createRecoveryCode', password: 'secret1' });
    const code = a.last('recoveryCode')!.code;
    expect(code).not.toBe(first);
    const c = new FakeConn();
    await send(c, { t: 'recover', username: 'Ana', code, password: 'brandnew' });
    expect(c.last('account')!.username).toBe('Ana');
    const guest = new FakeConn();
    await send(guest, { t: 'createRecoveryCode', password: 'secret1' });
    expect(guest.lastError()).toBe('not_logged_in');
  });
});

describe('rooms and blocks', () => {
  const accounts: Record<string, { id: string; username: string }> = {
    Ana: { id: '1', username: 'Ana' },
    Bob: { id: '2', username: 'Bob' },
  };
  /** Ana and Bob are logged in; Cy is a guest. Ana blocked Bob. */
  const opts = {
    accountOf: (c: Conn) => accounts[(c as FakeConn).label]?.id ?? null,
    usernameOf: (c: Conn) => accounts[(c as FakeConn).label]?.username ?? null,
    hidesFrom: (viewer: Conn, accountId: string) => (viewer as FakeConn).label === 'Ana' && accountId === '2',
  };

  it('shows usernames on lobby and game seats only for logged-in players', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob', 'Cy'], opts);
    const seats = conns[2].last('lobby')!.lobby.seats;
    expect(seats.map((s) => s.username)).toEqual(['Ana', 'Bob', undefined]);
    room.handle(conns[0], { t: 'start' });
    const game = conns[2].last('game')!.seats.filter((s) => s.kind === 'human');
    expect(game.map((s) => s.username ?? '-').sort()).toEqual(['-', 'Ana', 'Bob']);
  });

  it('does not deliver a blocked account’s reactions to the blocker', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob', 'Cy'], opts);
    const [a, b, c] = conns;
    room.handle(b, { t: 'react', reaction: 'clap' });
    expect(a.last('reaction')).toBeUndefined();
    expect(c.last('reaction')?.reaction).toBe('clap');
    room.handle(a, { t: 'react', reaction: 'gg' });
    expect(b.last('reaction')?.reaction).toBe('gg');
  });
});

describe('quick match and blocks', () => {
  it('never seats two players kept apart at the same table', () => {
    const clock = new ManualClock(1_000_000);
    const apart = (x: Conn, y: Conn) => [x, y].map((c) => (c as FakeConn).label).sort().join() === 'Ana,Bob';
    const mgr = new RoomManager({ clientUrl: 'http://client', seed: () => 7, quickStartMs: 10_000, aiFillMs: null, apart }, clock);
    const queue = (name: string) => {
      const c = new FakeConn(name);
      mgr.onMessage(c, { t: 'queueJoin', kind: 'casual', queue: '1v1', name });
      return c;
    };
    const a = queue('Ana');
    const b = queue('Bob');
    expect(mgr.searching()).toBe(2);
    const c = queue('Cy');
    expect(a.last('joined')!.code).toBe(c.last('joined')!.code);
    expect(b.last('joined')).toBeUndefined();
    // Later: Bob still never lands with Ana; alone, he keeps waiting.
    clock.advance(120_000);
    expect(b.last('joined')).toBeUndefined();
    mgr.stop();
  });
});
