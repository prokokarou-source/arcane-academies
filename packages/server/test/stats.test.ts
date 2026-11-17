import { describe, expect, it } from 'vitest';
import type { LeaderRow, Queue, SocialMessage } from '@arcane/protocol';
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

describe('profile', () => {
  it('sends my full profile: identity, ranked tiles, totals with streaks, kinds, academies and the last 10 games', async () => {
    const { signup, send, store, clock, rec } = setup();
    const ana = await signup('Ana');
    await send(ana.c, { t: 'profile' });
    expect(ana.c.last('profile')?.profile).toEqual({
      username: 'Ana',
      country: null,
      memberSince: expect.any(Number),
      me: true,
      ranked: [
        { queue: '1v1', rating: null, division: 'apprentice', rank: null, countryRank: null },
        { queue: '3-5', rating: null, division: 'apprentice', rank: null, countryRank: null },
        { queue: '6-7', rating: null, division: 'apprentice', rank: null, countryRank: null },
      ],
      totals: { games: 0, wins: 0, totalScore: 0, bestScore: 0, streak: 0, bestStreak: 0 },
      byKind: { casual: { games: 0, wins: 0 }, ranked: { games: 0, wins: 0 } },
      academies: [],
      recent: [],
    });
    for (let i = 0; i < 12; i++) {
      clock.advance(1000);
      await store.recordResult({ ...rec(ana.id, i % 3 === 0, 30 + i), kind: i % 2 ? 'room' : 'bots', side: 'B' });
    }
    await send(ana.c, { t: 'profile' });
    const p = ana.c.last('profile')!.profile;
    expect(p.totals).toEqual({ games: 12, wins: 4, bestScore: 41, totalScore: 12 * 30 + 66, streak: 0, bestStreak: 1 });
    // Bot and room games count as casual.
    expect(p.byKind).toEqual({ casual: { games: 12, wins: 4 }, ranked: { games: 0, wins: 0 } });
    expect(p.academies).toEqual([{ academyId: 'ember', games: 12, wins: 4 }]);
    expect(p.recent).toHaveLength(10);
    expect(p.recent[0]).toEqual({ at: clock.now(), kind: 'room', academyId: 'ember', side: 'B', place: 2, score: 41, players: 3 });
  });

  it("shows another player's profile read-only, also to guests; unknown names fail", async () => {
    const { signup, send, store, rec } = setup();
    const ana = await signup('Ana');
    const bob = await signup('Bob');
    await store.recordResult(rec(bob.id, true));
    await send(ana.c, { t: 'profile', username: 'bob' });
    expect(ana.c.last('profile')!.profile).toMatchObject({ username: 'Bob', me: false, totals: { games: 1, wins: 1 } });
    // Old records without kind or side read as casual, side A.
    expect(ana.c.last('profile')!.profile.recent[0]).toMatchObject({ kind: 'casual', side: 'A' });
    await send(ana.c, { t: 'profile', username: 'Ana' });
    expect(ana.c.last('profile')!.profile.me).toBe(true);
    const guest = new FakeConn();
    await send(guest, { t: 'profile', username: 'Bob' });
    expect(guest.last('profile')!.profile).toMatchObject({ username: 'Bob', me: false });
    await send(guest, { t: 'profile', username: 'Nobody' });
    expect(guest.lastError()).toBe('no_user');
    await send(guest, { t: 'profile' });
    expect(guest.lastError()).toBe('not_logged_in');
  });

  it('sets and clears my country (ISO codes only) and answers with my profile', async () => {
    const { signup, send } = setup();
    const ana = await signup('Ana');
    await send(ana.c, { t: 'setCountry', country: 'GR' });
    expect(ana.c.last('profile')!.profile).toMatchObject({ username: 'Ana', country: 'GR', me: true });
    await send(ana.c, { t: 'setCountry', country: 'XX' });
    expect(ana.c.lastError()).toBe('bad_message');
    await send(ana.c, { t: 'setCountry', country: null });
    expect(ana.c.last('profile')!.profile.country).toBeNull();
    const guest = new FakeConn();
    await send(guest, { t: 'setCountry', country: 'GR' });
    expect(guest.lastError()).toBe('not_logged_in');
  });
});

describe('ranked ratings', () => {
  const ranked = (r: GameRecord, queue: Queue, place: number): GameRecord => ({ ...r, kind: 'ranked', queue, place, won: place === 1 });

  it('applies 1v1 Elo to ranked games, keeps the change in the history, and leaves other games alone', async () => {
    const { signup, send, social, rec, clock } = setup();
    const ana = await signup('Ana');
    const bob = await signup('Bob');
    await social.recordResults([ranked(rec(ana.id, true), '1v1', 1), ranked(rec(bob.id, false), '1v1', 2)]);
    clock.advance(1000);
    await social.recordResults([
      { ...rec(ana.id, true), kind: 'casual', queue: '1v1' },
      { ...rec(bob.id, false), kind: 'casual', queue: '1v1' },
    ]);
    await send(ana.c, { t: 'profile' });
    const p = ana.c.last('profile')!.profile;
    expect(p.ranked[0]).toEqual({ queue: '1v1', rating: 1016, division: 'apprentice', rank: 1, countryRank: null });
    expect(p.ranked[1].rating).toBeNull();
    expect(p.recent.map((g) => g.ratingDelta)).toEqual([undefined, 16]);
    expect(p.recent[1]).toMatchObject({ kind: 'ranked', queue: '1v1' });
    expect(p.byKind).toEqual({ casual: { games: 1, wins: 1 }, ranked: { games: 1, wins: 1 } });
    await send(bob.c, { t: 'profile' });
    expect(bob.c.last('profile')!.profile.ranked[0]).toMatchObject({ rating: 984, rank: 2 });
    // Games saved at the same moment are applied in order, each from the ratings the previous one left.
    clock.advance(1000);
    void social.recordResults([ranked(rec(ana.id, true), '1v1', 1), ranked(rec(bob.id, false), '1v1', 2)]);
    await social.recordResults([ranked(rec(ana.id, true), '1v1', 1), ranked(rec(bob.id, false), '1v1', 2)]);
    await send(ana.c, { t: 'profile' });
    const after = ana.c.last('profile')!.profile;
    expect(after.recent.slice(0, 2).map((g) => g.ratingDelta)).toEqual([13, 15]);
    expect(after.ranked[0].rating).toBe(1016 + 15 + 13);
  });

  it('rates multiplayer queues pairwise by place, per queue', async () => {
    const { signup, send, social, rec } = setup();
    const ps = await Promise.all(['Ana', 'Bob', 'Cyd', 'Dee'].map(signup));
    await social.recordResults(ps.map((p, i) => ranked(rec(p.id, i === 0), '3-5', i + 1)));
    await send(ps[0].c, { t: 'leaderboard', queue: '3-5', scope: 'global' });
    const msg = ps[0].c.last('leaderboard')!;
    expect(msg.rows.map((r) => [r.rank, r.username, r.rating, r.games])).toEqual([
      [1, 'Ana', 1016, 1],
      [2, 'Bob', 1005, 1],
      [3, 'Cyd', 995, 1],
      [4, 'Dee', 984, 1],
    ]);
    await send(ps[0].c, { t: 'leaderboard', queue: '1v1', scope: 'global' });
    expect(ps[0].c.last('leaderboard')!.rows).toEqual([]);
  });

  it('a ranked game with a single account changes no rating', async () => {
    const { signup, send, social, rec } = setup();
    const ana = await signup('Ana');
    await social.recordResults([ranked(rec(ana.id, true), '1v1', 1)]);
    await send(ana.c, { t: 'profile' });
    const p = ana.c.last('profile')!.profile;
    expect(p.ranked[0].rating).toBeNull();
    expect(p.recent[0].ratingDelta).toBeUndefined();
  });
});

describe('leaderboards', () => {
  async function world() {
    const t = setup();
    const [ana, bob, cyd, dee, eve] = await Promise.all(['Ana', 'Bob', 'Cyd', 'Dee', 'Eve'].map(t.signup));
    // Ratings in 6-7: Bob 1100, Ana 1050, Cyd 1050, Dee 990; Eve unrated.
    await t.store.addRating(bob.id, '6-7', 100);
    await t.store.addRating(ana.id, '6-7', 50);
    await t.store.addRating(cyd.id, '6-7', 50);
    await t.store.addRating(dee.id, '6-7', -10);
    await t.store.setCountry(ana.id, 'GR');
    await t.store.setCountry(bob.id, 'FR');
    await t.store.setCountry(cyd.id, 'GR');
    await t.store.setCountry(dee.id, 'JP');
    await t.befriend(ana.c, dee.c, 'Dee', 'Ana');
    await t.send(ana.c, { t: 'friendRequest', username: 'Bob' }); // pending: not a friend yet
    const board = async (who: FakeConn, m: Omit<Extract<SocialMessage, { t: 'leaderboard' }>, 't'>) => {
      await t.send(who, { t: 'leaderboard', ...m });
      return who.last('leaderboard')!;
    };
    return { ...t, ana, bob, cyd, dee, eve, board };
  }
  const names = (rows: LeaderRow[]) => rows.map((r) => `${r.rank}:${r.username}`);

  it('global: rated players best first with shared ranks, division and country; my row always sent', async () => {
    const { ana, eve, board } = await world();
    const m = await board(ana.c, { queue: '6-7', scope: 'global' });
    expect(m.queue).toBe('6-7');
    expect(m.scope).toBe('global');
    expect(names(m.rows)).toEqual(['1:Bob', '2:Ana', '2:Cyd', '4:Dee']);
    expect(m.rows[0]).toEqual({ rank: 1, username: 'Bob', country: 'FR', division: 'adept', rating: 1100, games: 1 });
    expect(m.me).toEqual({ rank: 2, username: 'Ana', country: 'GR', division: 'apprentice', rating: 1050, games: 1 });
    const e = await board(eve.c, { queue: '6-7', scope: 'global' });
    expect(e.me).toEqual({ rank: null, username: 'Eve', country: null, division: 'apprentice', rating: null, games: 0 });
  });

  it('friends: me and accepted friends only, ranked among themselves', async () => {
    const { ana, board } = await world();
    const m = await board(ana.c, { queue: '6-7', scope: 'friends' });
    expect(names(m.rows)).toEqual(['1:Ana', '2:Dee']);
    expect(m.me!.rank).toBe(1);
  });

  it('country and continent follow my country; nothing without one', async () => {
    const { ana, bob, eve, board, store } = await world();
    expect(names((await board(ana.c, { queue: '6-7', scope: 'country' })).rows)).toEqual(['1:Ana', '1:Cyd']);
    const eu = await board(ana.c, { queue: '6-7', scope: 'continent' });
    expect(names(eu.rows)).toEqual(['1:Bob', '2:Ana', '2:Cyd']);
    expect(eu.me!.rank).toBe(2);
    expect(names((await board(bob.c, { queue: '6-7', scope: 'country' })).rows)).toEqual(['1:Bob']);
    const none = await board(eve.c, { queue: '6-7', scope: 'country' });
    expect(none.rows).toEqual([]);
    expect(none.me).toMatchObject({ username: 'Eve', rank: null });
    await store.setCountry(eve.id, 'GR');
    expect((await board(eve.c, { queue: '6-7', scope: 'country' })).me).toMatchObject({ rank: null, country: 'GR' });
  });

  it('search filters by name, ignoring case, and keeps the scope ranks', async () => {
    const { ana, board } = await world();
    const m = await board(ana.c, { queue: '6-7', scope: 'global', search: 'CY' });
    expect(names(m.rows)).toEqual(['2:Cyd']);
    expect(m.me!.rank).toBe(2);
    expect((await board(ana.c, { queue: '6-7', scope: 'global', search: 'zz' })).rows).toEqual([]);
  });

  it('shows a profile with global and country ranks per queue', async () => {
    const { ana, send } = await world();
    await send(ana.c, { t: 'profile', username: 'Cyd' });
    expect(ana.c.last('profile')!.profile.ranked[2]).toEqual({ queue: '6-7', rating: 1050, division: 'apprentice', rank: 2, countryRank: 1 });
  });

  it('guests can read global boards (me is null) but not the friends board', async () => {
    const { board } = await world();
    const guest = new FakeConn();
    const m = await board(guest, { queue: '6-7', scope: 'global' });
    expect(m.rows).toHaveLength(4);
    expect(m.me).toBeNull();
    expect((await board(guest, { queue: '6-7', scope: 'continent' })).rows).toEqual([]);
    await board(guest, { queue: '6-7', scope: 'friends' });
    expect(guest.lastError()).toBe('not_logged_in');
  });

  it('sends at most 100 rows; my row keeps my rank beyond them', async () => {
    const { store, ana, board } = await world();
    // 105 more players rated 1000..1104: 54 of them above Ana's 1050, plus Bob.
    for (let i = 0; i < 105; i++) {
      const u = (await store.createUser(`p${i}`, 'h'))!;
      await store.addRating(u.id, '6-7', i);
    }
    const m = await board(ana.c, { queue: '6-7', scope: 'global' });
    expect(m.rows).toHaveLength(100);
    expect(m.me!.rank).toBe(56);
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
