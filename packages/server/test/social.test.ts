import { describe, expect, it } from 'vitest';
import type { SocialMessage } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { FAILURE_WINDOW_MS, MAX_FAILURES, Social } from '../src/social';
import { MemoryStore } from '../src/store';
import type { Conn } from '../src/room';
import { FakeConn } from './fakes';

/** Let fire-and-forget presence updates finish. */
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
  const login = async (username: string) => {
    const c = new FakeConn(username);
    await send(c, { t: 'login', username, password: 'secret1' });
    return c;
  };
  /** A connection logged into a new account. Returns the conn and its saved token. */
  const signup = async (username: string) => {
    const c = new FakeConn(username);
    await send(c, { t: 'signup', username, password: 'secret1' });
    return { c, token: c.last('account')!.token! };
  };
  /** Two accounts that are already friends. */
  const friends = async () => {
    const a = await signup('Ana');
    const b = await signup('Bob');
    await send(a.c, { t: 'friendRequest', username: 'bob' });
    await send(b.c, { t: 'friendAccept', username: 'Ana' });
    return { a: a.c, b: b.c };
  };
  return { store, clock, rooms, social, send, login, signup, friends };
}

describe('accounts', () => {
  it('signs up, answering with the username, a token and an empty friend list', async () => {
    const { signup } = setup();
    const { c, token } = await signup('Ana');
    expect(c.last('account')).toEqual({ t: 'account', username: 'Ana', token });
    expect(c.last('friends')?.list).toEqual({ friends: [], incoming: [], outgoing: [] });
  });

  it('rejects bad usernames, short passwords and taken names (ignoring case)', async () => {
    const { send, signup } = setup();
    const c = new FakeConn();
    await send(c, { t: 'signup', username: 'a b', password: 'secret1' });
    expect(c.lastError()).toBe('bad_username');
    await send(c, { t: 'signup', username: 'Ana', password: '123' });
    expect(c.lastError()).toBe('bad_password');
    await signup('Ana');
    await send(c, { t: 'signup', username: 'ANA', password: 'secret1' });
    expect(c.lastError()).toBe('username_taken');
    expect(c.last('account')).toBeUndefined();
  });

  it('logs in with the right password only, and never stores the password or token', async () => {
    const { send, signup, store } = setup();
    const { token } = await signup('Ana');
    const stored = await store.findUser('ana');
    expect(stored!.passHash).not.toContain('secret1');
    expect(JSON.stringify([...Object.values(store)].map((v) => (v instanceof Map ? [...v] : v)))).not.toContain(token);

    const c = new FakeConn();
    await send(c, { t: 'login', username: 'ana', password: 'wrong!!' });
    expect(c.lastError()).toBe('bad_login');
    await send(c, { t: 'login', username: 'nobody', password: 'secret1' });
    expect(c.lastError()).toBe('bad_login');
    await send(c, { t: 'login', username: 'ana', password: 'secret1' });
    expect(c.last('account')).toMatchObject({ username: 'Ana', token: expect.any(String) });
  });

  it('resumes a saved token on a new connection; logout ends it everywhere', async () => {
    const { send, signup, social } = setup();
    const { c: first, token } = await signup('Ana');
    const c = new FakeConn();
    await send(c, { t: 'auth', token });
    expect(c.last('account')).toEqual({ t: 'account', username: 'Ana' });
    expect(social.userOf(c)?.username).toBe('Ana');

    await send(c, { t: 'logout' });
    expect(c.last('account')).toEqual({ t: 'account', username: null });
    expect(first.last('account')).toEqual({ t: 'account', username: null });
    expect(social.userOf(first)).toBeNull();
    const again = new FakeConn();
    await send(again, { t: 'auth', token });
    expect(again.lastError()).toBe('bad_session');
  });

  it('refuses more logins after repeated failures, until the window passes', async () => {
    const { send, signup, clock } = setup();
    await signup('Ana');
    const c = new FakeConn();
    for (let i = 0; i < MAX_FAILURES; i++) await send(c, { t: 'login', username: 'Ana', password: 'nope!!' });
    await send(c, { t: 'login', username: 'Ana', password: 'secret1' });
    expect(c.lastError()).toBe('too_many_attempts');
    clock.advance(FAILURE_WINDOW_MS + 1);
    await send(c, { t: 'login', username: 'Ana', password: 'secret1' });
    expect(c.last('account')?.username).toBe('Ana');
  });

  it('answers "unavailable" when the database fails', async () => {
    const { store, send } = setup();
    const log = console.error;
    console.error = () => {};
    store.findUser = () => Promise.reject(new Error('db down'));
    const c = new FakeConn();
    await send(c, { t: 'login', username: 'Ana', password: 'secret1' });
    console.error = log;
    expect(c.lastError()).toBe('unavailable');
  });
});

describe('friends', () => {
  it('needs a login', async () => {
    const { send } = setup();
    const c = new FakeConn();
    await send(c, { t: 'friendRequest', username: 'Bob' });
    expect(c.lastError()).toBe('not_logged_in');
  });

  it('sends a request that both sides see, then accepting makes them friends', async () => {
    const { send, signup } = setup();
    const { c: a } = await signup('Ana');
    const { c: b } = await signup('Bob');
    await send(a, { t: 'friendRequest', username: 'BOB' });
    expect(a.last('friends')?.list).toEqual({ friends: [], incoming: [], outgoing: ['Bob'] });
    expect(b.last('friends')?.list).toEqual({ friends: [], incoming: ['Ana'], outgoing: [] });
    await send(b, { t: 'friendAccept', username: 'Ana' });
    expect(a.last('friends')?.list.friends).toEqual([{ username: 'Bob', online: true }]);
    expect(b.last('friends')?.list.friends).toEqual([{ username: 'Ana', online: true }]);
  });

  it('asking someone who already asked you accepts their request', async () => {
    const { send, signup } = setup();
    const { c: a } = await signup('Ana');
    const { c: b } = await signup('Bob');
    await send(a, { t: 'friendRequest', username: 'Bob' });
    await send(b, { t: 'friendRequest', username: 'Ana' });
    expect(b.last('friends')?.list.friends).toEqual([{ username: 'Ana', online: true }]);
  });

  it('rejects unknown names and yourself', async () => {
    const { send, signup } = setup();
    const { c } = await signup('Ana');
    await send(c, { t: 'friendRequest', username: 'Ghost' });
    expect(c.lastError()).toBe('no_user');
    await send(c, { t: 'friendRequest', username: 'ana' });
    expect(c.lastError()).toBe('no_user');
  });

  it('declining or unfriending clears both lists', async () => {
    const { send, friends } = setup();
    const { a, b } = await friends();
    await send(b, { t: 'friendRemove', username: 'Ana' });
    expect(a.last('friends')?.list).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(b.last('friends')?.list).toEqual({ friends: [], incoming: [], outgoing: [] });
  });

  it('shows friends who are offline and lists online ones first', async () => {
    const { send, signup, social } = setup();
    const { c: a } = await signup('Ana');
    for (const name of ['Bob', 'Zed']) {
      const { c } = await signup(name);
      await send(a, { t: 'friendRequest', username: name });
      await send(c, { t: 'friendAccept', username: 'Ana' });
      if (name === 'Bob') social.onClose(c);
    }
    expect((await social.friendList(social.userOf(a)!.id)).friends).toEqual([
      { username: 'Zed', online: true },
      { username: 'Bob', online: false },
    ]);
  });
});

describe('presence', () => {
  it('tells friends when someone goes offline (last tab) and comes back', async () => {
    const { friends, login, social } = setup();
    const { a, b } = await friends();
    const b2 = await login('Bob');
    // Bob has two tabs open: closing one keeps him online.
    social.onClose(b);
    await settle();
    expect(a.last('presence')).toBeUndefined();
    social.onClose(b2);
    await settle();
    expect(a.last('presence')).toEqual({ t: 'presence', username: 'Bob', online: false });

    const back = await login('Bob');
    expect(a.last('presence')).toEqual({ t: 'presence', username: 'Bob', online: true });
    expect(back.last('friends')?.list.friends).toEqual([{ username: 'Ana', online: true }]);
  });

  it('does not tell people who only have a pending request', async () => {
    const { send, signup, social } = setup();
    const { c: a } = await signup('Ana');
    const { c: b } = await signup('Bob');
    await send(a, { t: 'friendRequest', username: 'Bob' });
    social.onClose(b);
    await settle();
    expect(a.last('presence')).toBeUndefined();
  });
});

describe('invites', () => {
  it('sends my room code to every open tab of an online friend', async () => {
    const { send, friends, login, rooms } = setup();
    const { a, b } = await friends();
    const b2 = await login('Bob');
    rooms.set(a, 'WAND-42');
    await send(a, { t: 'invite', username: 'bob' });
    expect(b.last('invite')).toEqual({ t: 'invite', from: 'Ana', code: 'WAND-42' });
    expect(b2.last('invite')).toEqual({ t: 'invite', from: 'Ana', code: 'WAND-42' });
  });

  it('needs a room, a friendship and an online friend', async () => {
    const { send, friends, signup, rooms, social } = setup();
    const { a, b } = await friends();
    await send(a, { t: 'invite', username: 'Bob' });
    expect(a.lastError()).toBe('invite_no_room');

    rooms.set(a, 'WAND-42');
    await signup('Cyd');
    await send(a, { t: 'invite', username: 'Cyd' });
    expect(a.lastError()).toBe('not_friends');

    social.onClose(b);
    await send(a, { t: 'invite', username: 'Bob' });
    expect(a.lastError()).toBe('friend_offline');
    expect(b.last('invite')).toBeUndefined();
  });
});
