import { describe, expect, it } from 'vitest';
import type { SocialMessage } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { Social } from '../src/social';
import { MemoryStore, type GameRecord } from '../src/store';
import type { Conn } from '../src/room';
import { FakeConn, lobbyWith, playToEnd } from './fakes';

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const store = new MemoryStore();
  const clock = new ManualClock(1_000_000);
  const social = new Social(store, { roomOf: () => null, clock });
  const send = async (c: FakeConn, m: SocialMessage) => {
    await social.handle(c, m);
    await settle();
  };
  const signup = async (username: string) => {
    const c = new FakeConn(username);
    await send(c, { t: 'signup', username, password: 'secret1' });
    return { c, token: c.last('account')!.token!, id: social.userOf(c)!.id };
  };
  const befriend = async (a: FakeConn, b: FakeConn, bName: string, aName: string) => {
    await send(a, { t: 'friendRequest', username: bName });
    await send(b, { t: 'friendAccept', username: aName });
  };
  const rec = (userId: string, won: boolean, score = 40): GameRecord => ({
    userId,
    academyId: 'ember',
    score,
    place: won ? 1 : 2,
    won,
    players: 3,
    playedAt: clock.now(),
  });
  return { store, clock, social, send, signup, befriend, rec };
}

describe('recording games in rooms', () => {
  it('records one result per logged-in account when the game ends; guests and bots record nothing', () => {
    const accounts = new Map<Conn, string>();
    const results: GameRecord[][] = [];
    const { room, conns, clock } = lobbyWith(['Ana', 'Guest', 'Twin'], {
      accountOf: (c) => accounts.get(c) ?? null,
      onResults: (r) => results.push(r),
    });
    const [ana, guest, twin] = conns;
    // A login that completes after the seat was taken is picked up on rejoin.
    accounts.set(ana, 'u1');
    room.rejoin(ana, ana.last('joined')!.token);
    // The same account in a second seat counts once.
    accounts.set(twin, 'u1');
    room.rejoin(twin, twin.last('joined')!.token);
    room.handle(ana, { t: 'addBot', level: 'easy' });
    room.handle(ana, { t: 'start' });
    playToEnd(room, conns);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(1);
    const [r] = results[0];
    const end = ana.last('game')!;
    const mine = end.result!.scores.find((b) => b.seat === end.view.me)!;
    expect(r).toEqual({
      userId: 'u1',
      academyId: end.view.players[end.view.me].academyId,
      score: mine.total,
      place: expect.any(Number),
      won: end.result!.winners.includes(end.view.me),
      players: 4,
      playedAt: clock.now(),
      kind: 'room',
      side: end.view.players[end.view.me].side,
    });
    expect(r.won).toBe(r.place === 1);
    expect(guest.last('game')?.result).toBeDefined();
    // Later broadcasts of the ended game do not record it again.
    room.disconnect(guest);
    expect(results).toHaveLength(1);
  });

  it('a room without logged-in players records nothing', () => {
    const results: GameRecord[][] = [];
    const { room, conns } = lobbyWith(['A', 'B'], { accountOf: () => null, onResults: (r) => results.push(r) });
    room.handle(conns[0], { t: 'start' });
    playToEnd(room, conns);
    expect(results).toEqual([]);
  });
});

describe('profile and leaderboard', () => {
  it('sends totals and the last games, newest first', async () => {
    const { signup, send, store, clock, rec } = setup();
    const ana = await signup('Ana');
    await send(ana.c, { t: 'profile' });
    expect(ana.c.last('profile')?.profile).toEqual({ username: 'Ana', games: 0, wins: 0, totalScore: 0, bestScore: 0, recent: [] });
    for (let i = 0; i < 12; i++) {
      clock.advance(1000);
      await store.recordResult(rec(ana.id, i % 3 === 0, 30 + i));
    }
    await send(ana.c, { t: 'profile' });
    const p = ana.c.last('profile')!.profile;
    expect(p).toMatchObject({ games: 12, wins: 4, bestScore: 41, totalScore: 12 * 30 + 66 });
    expect(p.recent).toHaveLength(10);
    expect(p.recent[0]).toEqual({ at: clock.now(), academyId: 'ember', score: 41, place: 2, won: false, players: 3 });
  });

  it('ranks me and accepted friends by wins, then win rate; pending requests are left out', async () => {
    const { signup, send, befriend, store, rec } = setup();
    const ana = await signup('Ana');
    const bob = await signup('Bob');
    const cy = await signup('Cyd');
    const dee = await signup('Dee');
    await befriend(ana.c, bob.c, 'Bob', 'Ana');
    await befriend(ana.c, cy.c, 'Cyd', 'Ana');
    await send(ana.c, { t: 'friendRequest', username: 'Dee' });
    // Ana 2 of 4, Bob 2 of 2, Cy none, Dee (pending) 5 of 5.
    const plan: [string, number, number][] = [
      [ana.id, 2, 4],
      [bob.id, 2, 2],
      [dee.id, 5, 5],
    ];
    for (const [id, w, n] of plan) for (let i = 0; i < n; i++) await store.recordResult(rec(id, i < w));
    await send(ana.c, { t: 'leaderboard' });
    expect(ana.c.last('leaderboard')?.rows).toEqual([
      { username: 'Bob', games: 2, wins: 2, me: false },
      { username: 'Ana', games: 4, wins: 2, me: true },
      { username: 'Cyd', games: 0, wins: 0, me: false },
    ]);
  });

  it('needs a login', async () => {
    const { send } = setup();
    const c = new FakeConn();
    await send(c, { t: 'profile' });
    expect(c.lastError()).toBe('not_logged_in');
    await send(c, { t: 'leaderboard' });
    expect(c.lastError()).toBe('not_logged_in');
  });
});

describe('account management', () => {
  it('changes the password with the current one; other logins end, this one stays', async () => {
    const { signup, send, social } = setup();
    const { c, token } = await signup('Ana');
    const other = new FakeConn();
    await send(other, { t: 'login', username: 'Ana', password: 'secret1' });

    await send(c, { t: 'changePassword', current: 'wrong!!', next: 'secret2' });
    expect(c.lastError()).toBe('wrong_password');
    await send(c, { t: 'changePassword', current: 'secret1', next: '123' });
    expect(c.lastError()).toBe('bad_password');
    await send(c, { t: 'changePassword', current: 'secret1', next: 'secret2' });
    expect(c.last('passwordChanged')).toBeDefined();
    expect(social.userOf(c)?.username).toBe('Ana');
    expect(social.userOf(other)).toBeNull();
    expect(other.last('account')).toEqual({ t: 'account', username: null });

    const fresh = new FakeConn();
    await send(fresh, { t: 'auth', token });
    expect(fresh.last('account')?.username).toBe('Ana'); // my own login survives
    await send(fresh, { t: 'login', username: 'Ana', password: 'secret1' });
    expect(fresh.lastError()).toBe('bad_login');
    await send(fresh, { t: 'login', username: 'Ana', password: 'secret2' });
    expect(fresh.last('account')).toMatchObject({ username: 'Ana', token: expect.any(String) });
  });

  it('stops guessing the current password after repeated failures', async () => {
    const { signup, send } = setup();
    const { c } = await signup('Ana');
    for (let i = 0; i < 5; i++) await send(c, { t: 'changePassword', current: 'nope!!', next: 'secret2' });
    await send(c, { t: 'deleteAccount', password: 'secret1' });
    expect(c.lastError()).toBe('too_many_attempts');
  });

  it('logs out on all devices', async () => {
    const { signup, send, social } = setup();
    const { c, token } = await signup('Ana');
    const other = new FakeConn();
    await send(other, { t: 'auth', token });
    await send(c, { t: 'logoutAll' });
    expect(social.userOf(c)).toBeNull();
    expect(social.userOf(other)).toBeNull();
    expect(c.last('account')).toEqual({ t: 'account', username: null });
    const again = new FakeConn();
    await send(again, { t: 'auth', token });
    expect(again.lastError()).toBe('bad_session');
  });

  it('deletes the account with its password; friends get updated lists', async () => {
    const { signup, send, befriend, social, store, rec } = setup();
    const ana = await signup('Ana');
    const bob = await signup('Bob');
    const cy = await signup('Cyd');
    await befriend(ana.c, bob.c, 'Bob', 'Ana');
    await send(ana.c, { t: 'friendRequest', username: 'Cyd' });
    await store.recordResult(rec(ana.id, true));

    await send(ana.c, { t: 'deleteAccount', password: 'wrong!!' });
    expect(ana.c.lastError()).toBe('wrong_password');
    expect(social.userOf(ana.c)).not.toBeNull();

    await send(ana.c, { t: 'deleteAccount', password: 'secret1' });
    expect(ana.c.last('account')).toEqual({ t: 'account', username: null });
    expect(social.userOf(ana.c)).toBeNull();
    expect(bob.c.last('friends')?.list.friends).toEqual([]);
    expect(cy.c.last('friends')?.list.incoming).toEqual([]);
    expect(await store.findUser('Ana')).toBeNull();
    expect(await store.history(ana.id, 10)).toEqual([]);
    const again = new FakeConn();
    await send(again, { t: 'auth', token: ana.token });
    expect(again.lastError()).toBe('bad_session');
  });

  it('never logs passwords when the database fails', async () => {
    const { signup, send, store } = setup();
    const { c } = await signup('Ana');
    const lines: string[] = [];
    const log = console.error;
    console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
    store.findUser = () => Promise.reject(new Error('db down'));
    await send(c, { t: 'changePassword', current: 'secret1', next: 'hunter22' });
    console.error = log;
    expect(c.lastError()).toBe('unavailable');
    expect(lines.join('\n')).not.toMatch(/secret1|hunter22/);
  });
});
