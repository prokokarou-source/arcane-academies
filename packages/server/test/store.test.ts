import { afterAll, describe, expect, it } from 'vitest';
import { hashPassword, hashToken, newToken, verifyPassword } from '../src/passwords';
import { PgStore } from '../src/pgStore';
import { MAX_PUSH_SUBS, MemoryStore, type Store } from '../src/store';

describe('passwords', () => {
  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horsf', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('makes long random tokens and stores only their hash', () => {
    const t = newToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });
});

/** The same behaviour is required from every store. */
function contract(name: string, make: () => Store) {
  describe(name, () => {
    const store = make();
    const uniq = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(-8);
    const n = (s: string) => `${s}_${uniq}`;
    afterAll(() => store.close());

    it('creates users with case-insensitive unique names', async () => {
      await store.init();
      const ana = await store.createUser(n('Ana'), 'h1');
      expect(ana).toEqual({ id: expect.any(String), username: n('Ana') });
      expect(await store.createUser(n('ANA'), 'h2')).toBeNull();
      expect(await store.findUser(n('ana'))).toEqual({ ...ana, passHash: 'h1', recoveryHash: null });
      expect(await store.findUser(n('nobody'))).toBeNull();
    });

    it('keeps sessions by token hash until deleted', async () => {
      const bob = (await store.createUser(n('Bob'), 'h'))!;
      await store.createSession(`tok-${uniq}`, bob.id);
      expect(await store.sessionUser(`tok-${uniq}`)).toEqual(bob);
      await store.deleteSession(`tok-${uniq}`);
      expect(await store.sessionUser(`tok-${uniq}`)).toBeNull();
    });

    it('tracks friend requests, acceptance and removal in either direction', async () => {
      const cy = (await store.createUser(n('Cy'), 'h'))!;
      const di = (await store.createUser(n('Di'), 'h'))!;
      expect(await store.link(cy.id, di.id)).toBeNull();
      await store.addRequest(cy.id, di.id);
      await store.addRequest(di.id, cy.id); // a second, reverse row is never added
      expect(await store.link(di.id, cy.id)).toEqual({ from: cy.id, to: di.id, accepted: false });
      expect(await store.friendRows(cy.id)).toEqual([{ other: di, accepted: false, outgoing: true }]);
      expect(await store.friendRows(di.id)).toEqual([{ other: cy, accepted: false, outgoing: false }]);
      await store.accept(cy.id, di.id);
      expect((await store.link(cy.id, di.id))?.accepted).toBe(true);
      await store.removeLink(di.id, cy.id);
      expect(await store.link(cy.id, di.id)).toBeNull();
      expect(await store.friendRows(cy.id)).toEqual([]);
    });

    it('changes passwords and ends all sessions but the kept one', async () => {
      const ed = (await store.createUser(n('Ed'), 'old'))!;
      await store.setPassword(ed.id, 'new');
      expect((await store.findUser(n('Ed')))?.passHash).toBe('new');
      await store.createSession(`e1-${uniq}`, ed.id);
      await store.createSession(`e2-${uniq}`, ed.id);
      await store.deleteSessions(ed.id, `e1-${uniq}`);
      expect(await store.sessionUser(`e1-${uniq}`)).toEqual(ed);
      expect(await store.sessionUser(`e2-${uniq}`)).toBeNull();
      await store.deleteSessions(ed.id);
      expect(await store.sessionUser(`e1-${uniq}`)).toBeNull();
    });

    it('records results and sums them, newest first in the history', async () => {
      const fa = (await store.createUser(n('Fa'), 'h'))!;
      const gi = (await store.createUser(n('Gi'), 'h'))!;
      const rec = (score: number, won: boolean, playedAt: number) =>
        store.recordResult({ userId: fa.id, academyId: 'ember', score, place: won ? 1 : 2, won, players: 3, playedAt });
      await rec(40, true, 1_000_000);
      await rec(55, false, 3_000_000);
      await rec(30, true, 2_000_000);
      const t = await store.totals([fa.id, gi.id]);
      expect(t.get(fa.id)).toEqual({ games: 3, wins: 2, totalScore: 125, bestScore: 55 });
      expect(t.get(gi.id)).toEqual({ games: 0, wins: 0, totalScore: 0, bestScore: 0 });
      const h = await store.history(fa.id, 2);
      expect(h.map((r) => r.score)).toEqual([55, 30]);
      expect(h[0]).toEqual({ userId: fa.id, academyId: 'ember', score: 55, place: 2, won: false, players: 3, playedAt: 3_000_000 });
    });

    it('deletes a user with sessions, friendships and results; results for gone users are ignored', async () => {
      const ho = (await store.createUser(n('Ho'), 'h'))!;
      const iv = (await store.createUser(n('Iv'), 'h'))!;
      await store.createSession(`h-${uniq}`, ho.id);
      await store.addRequest(ho.id, iv.id);
      await store.recordResult({ userId: ho.id, academyId: 'ember', score: 9, place: 1, won: true, players: 2, playedAt: 1 });
      await store.deleteUser(ho.id);
      expect(await store.findUser(n('Ho'))).toBeNull();
      expect(await store.sessionUser(`h-${uniq}`)).toBeNull();
      expect(await store.friendRows(iv.id)).toEqual([]);
      expect(await store.history(ho.id, 10)).toEqual([]);
      await store.recordResult({ userId: ho.id, academyId: 'ember', score: 9, place: 1, won: true, players: 2, playedAt: 2 });
      expect((await store.totals([ho.id])).get(ho.id)?.games).toBe(0);
      // The name is free again.
      expect(await store.createUser(n('Ho'), 'h')).not.toBeNull();
    });

    it('keeps push subscriptions per user; an endpoint moves to the latest user', async () => {
      const ed = (await store.createUser(n('Pe'), 'h'))!;
      const fy = (await store.createUser(n('Pf'), 'h'))!;
      const sub = (i: number) => ({ endpoint: `https://push.example.com/${uniq}/${i}`, keys: { p256dh: `p${i}`, auth: `a${i}` } });
      await store.addPushSub(ed.id, sub(1));
      await store.addPushSub(ed.id, { ...sub(1), keys: { p256dh: 'new', auth: 'new' } });
      expect(await store.pushSubs(ed.id)).toEqual([{ ...sub(1), keys: { p256dh: 'new', auth: 'new' } }]);
      await store.addPushSub(fy.id, sub(1));
      expect(await store.pushSubs(ed.id)).toEqual([]);
      expect(await store.pushSubs(fy.id)).toEqual([sub(1)]);
      await store.removePushSub(sub(1).endpoint, ed.id); // not Ed's: kept
      expect(await store.pushSubs(fy.id)).toHaveLength(1);
      await store.removePushSub(sub(1).endpoint);
      expect(await store.pushSubs(fy.id)).toEqual([]);
    });

    it('keeps at most MAX_PUSH_SUBS devices per user, dropping the oldest', async () => {
      const gi = (await store.createUser(n('Pg'), 'h'))!;
      for (let i = 0; i <= MAX_PUSH_SUBS; i++)
        await store.addPushSub(gi.id, { endpoint: `https://push.example.com/${uniq}/g${i}`, keys: { p256dh: 'p', auth: 'a' } });
      const kept = (await store.pushSubs(gi.id)).map((s) => s.endpoint);
      expect(kept).toHaveLength(MAX_PUSH_SUBS);
      expect(kept).not.toContain(`https://push.example.com/${uniq}/g0`);
    });

    it('stores and clears a recovery code hash', async () => {
      const rc = (await store.createUser(n('Rc'), 'h'))!;
      await store.setRecoveryHash(rc.id, 'scrypt$x');
      expect((await store.findUser(n('Rc')))?.recoveryHash).toBe('scrypt$x');
      await store.setRecoveryHash(rc.id, null);
      expect((await store.findUser(n('Rc')))?.recoveryHash).toBeNull();
    });

    it('blocks one way, removes the friendship, and forgets blocks with the account', async () => {
      const ja = (await store.createUser(n('Ja'), 'h'))!;
      const ke = (await store.createUser(n('Ke'), 'h'))!;
      await store.addRequest(ja.id, ke.id);
      await store.accept(ja.id, ke.id);
      await store.addBlock(ke.id, ja.id);
      await store.addBlock(ke.id, ja.id);
      expect(await store.link(ja.id, ke.id)).toBeNull();
      expect(await store.blocks(ke.id)).toEqual([{ id: ja.id, username: n('Ja') }]);
      expect(await store.blocks(ja.id)).toEqual([]);
      expect(await store.blockedEither(ja.id, ke.id)).toBe(true);
      expect(await store.blockedEither(ke.id, ja.id)).toBe(true);
      await store.removeBlock(ke.id, ja.id);
      expect(await store.blockedEither(ja.id, ke.id)).toBe(false);
      await store.addBlock(ja.id, ke.id);
      await store.deleteUser(ke.id);
      expect(await store.blocks(ja.id)).toEqual([]);
    });

    it('keeps reports newest first, even after the accounts are gone', async () => {
      const lu = (await store.createUser(n('Lu'), 'h'))!;
      const mo = (await store.createUser(n('Mo'), 'h'))!;
      const base = { reporterId: lu.id, reporter: n('Lu'), targetId: mo.id, target: n('Mo'), note: '', roomCode: null };
      await store.addReport({ ...base, reason: 'name', at: 1_000 });
      await store.addReport({ ...base, reason: 'cheating', note: 'odd', roomCode: 'WAND-42', at: 2_000 });
      await store.deleteUser(mo.id);
      const mine = (await store.recentReports(500)).filter((r) => r.reporter === n('Lu'));
      expect(mine.map((r) => [r.reason, r.target, r.note, r.roomCode, r.at])).toEqual([
        ['cheating', n('Mo'), 'odd', 'WAND-42', 2_000],
        ['name', n('Mo'), '', null, 1_000],
      ]);
    });

    it('saves an avatar, shows it on login, session and friend rows, and resets it', async () => {
      const av = (await store.createUser(n('Av'), 'h'))!;
      const fr = (await store.createUser(n('Aw'), 'h'))!;
      expect((await store.findUser(n('Av')))!.avatar).toBeUndefined();
      await store.setAvatar(av.id, { icon: 'owl', color: 'teal' });
      expect((await store.findUser(n('Av')))!.avatar).toEqual({ icon: 'owl', color: 'teal' });
      const tok = `avatar-${uniq}`;
      await store.createSession(tok, av.id);
      expect(await store.sessionUser(tok)).toEqual({ id: av.id, username: n('Av'), avatar: { icon: 'owl', color: 'teal' } });
      await store.addRequest(fr.id, av.id);
      expect((await store.friendRows(fr.id))[0].other.avatar).toEqual({ icon: 'owl', color: 'teal' });
      await store.setAvatar(av.id, null);
      expect(await store.sessionUser(tok)).toEqual({ id: av.id, username: n('Av') });
    });

    it('keeps a country and the signup time on the account', async () => {
      const before = Date.now() - 60_000;
      const co = (await store.createUser(n('Co'), 'h'))!;
      const acc = (await store.account(co.id))!;
      expect(acc).toEqual({ user: co, country: null, memberSince: expect.any(Number) });
      expect(acc.memberSince).toBeGreaterThan(before);
      await store.setCountry(co.id, 'GR');
      expect((await store.account(co.id))!.country).toBe('GR');
      await store.setCountry(co.id, null);
      expect((await store.account(co.id))!.country).toBeNull();
      expect(await store.account('999999999')).toBeNull();
    });

    it('stores kind, queue, side and rating change with a result; old-style records read without them', async () => {
      const ki = (await store.createUser(n('Ki'), 'h'))!;
      const base = { userId: ki.id, academyId: 'ember', score: 50, place: 1, won: true, players: 3 };
      await store.recordResult({ ...base, playedAt: 1_000, kind: 'ranked', queue: '1v1', side: 'B', ratingDelta: -7 });
      await store.recordResult({ ...base, playedAt: 2_000 });
      const [plain, ranked] = await store.history(ki.id, 5);
      expect(plain).toEqual({ ...base, playedAt: 2_000 });
      expect(ranked).toEqual({ ...base, playedAt: 1_000, kind: 'ranked', queue: '1v1', side: 'B', ratingDelta: -7 });
    });

    it('keeps ratings per queue from 1000 and ranks them inside a scope; search keeps the scope ranks', async () => {
      const [ra, rb, rc, rd] = await Promise.all(['Qa', 'Qb', 'Qc', 'Qd'].map(async (x) => (await store.createUser(n(x), 'h'))!));
      await store.addRating(ra.id, '3-5', 40);
      await store.addRating(ra.id, '3-5', -10);
      await store.addRating(rb.id, '3-5', 30);
      await store.addRating(rc.id, '3-5', -5);
      await store.addRating(rc.id, '1v1', 16);
      await store.addRating('999999999', '3-5', 10); // gone users are ignored
      await store.setCountry(ra.id, 'GR');
      await store.setCountry(rb.id, 'GR');
      await store.setCountry(rc.id, 'FR');
      const r = await store.ratings('3-5', [ra.id, rb.id, rc.id, rd.id]);
      expect(r.get(ra.id)).toEqual({ rating: 1030, games: 2 });
      expect(r.get(rb.id)).toEqual({ rating: 1030, games: 1 });
      expect(r.has(rd.id)).toBe(false);
      expect((await store.ratings('1v1', [rc.id])).get(rc.id)).toEqual({ rating: 1016, games: 1 });

      const scope = { userIds: [ra.id, rb.id, rc.id, rd.id] };
      const board = await store.leaderboard('3-5', scope, null, 10);
      // Equal ratings share rank 1; then a gap.
      expect(board.map((x) => [x.user.username, x.rank, x.rating])).toEqual([
        [n('Qa'), 1, 1030],
        [n('Qb'), 1, 1030],
        [n('Qc'), 3, 995],
      ]);
      expect(board[0]).toEqual({ user: ra, country: 'GR', rating: 1030, games: 2, rank: 1 });
      expect((await store.leaderboard('3-5', scope, null, 1)).length).toBe(1);
      const found = await store.leaderboard('3-5', scope, 'qc_', 10);
      expect(found.map((x) => [x.user.username, x.rank])).toEqual([[n('Qc'), 3]]);
      expect(await store.rankOf('3-5', rc.id, scope)).toBe(3);
      expect(await store.rankOf('3-5', rd.id, scope)).toBeNull();
      expect(await store.rankOf('6-7', ra.id, scope)).toBeNull();
      // Country scope combines with ids here so other data in a shared database cannot interfere.
      expect(await store.rankOf('3-5', rc.id, { ...scope, countries: ['FR'] })).toBe(1);
      expect((await store.leaderboard('3-5', { ...scope, countries: ['GR', 'DE'] }, null, 10)).map((x) => x.user.id)).toEqual([ra.id, rb.id]);
      // Global search finds by name part, case-insensitive.
      const global = await store.leaderboard('3-5', {}, `qb_${uniq}`.toLowerCase(), 10);
      expect(global.map((x) => x.user.id)).toEqual([rb.id]);
      expect(global[0].rank).toBeGreaterThanOrEqual(1);

      await store.deleteUser(ra.id);
      expect((await store.ratings('3-5', [ra.id])).size).toBe(0);
    });

    it('sums profile stats: streaks, casual vs ranked, academies', async () => {
      const ps = (await store.createUser(n('Ps'), 'h'))!;
      const plan: [string, boolean, 'ranked' | 'room' | undefined][] = [
        ['ember', true, 'ranked'],
        ['ember', true, undefined],
        ['tide', true, 'room'],
        ['ember', false, 'ranked'],
        ['tide', true, 'ranked'],
      ];
      let at = 10_000;
      for (const [academyId, won, kind] of plan) {
        at += 1000;
        await store.recordResult({ userId: ps.id, academyId, score: won ? 50 : 30, place: won ? 1 : 2, won, players: 3, playedAt: at, ...(kind ? { kind } : {}) });
      }
      expect(await store.profileStats(ps.id)).toEqual({
        totals: { games: 5, wins: 4, totalScore: 230, bestScore: 50, streak: 1, bestStreak: 3 },
        byKind: { casual: { games: 2, wins: 2 }, ranked: { games: 3, wins: 2 } },
        academies: [
          { academyId: 'ember', games: 3, wins: 2 },
          { academyId: 'tide', games: 2, wins: 2 },
        ],
      });
      const none = (await store.createUser(n('Pn'), 'h'))!;
      expect(await store.profileStats(none.id)).toEqual({
        totals: { games: 0, wins: 0, totalScore: 0, bestScore: 0, streak: 0, bestStreak: 0 },
        byKind: { casual: { games: 0, wins: 0 }, ranked: { games: 0, wins: 0 } },
        academies: [],
      });
    });
  });
}

contract('memory store', () => new MemoryStore());

// Runs against a real database only when one is provided (never the production one).
const testDb = process.env.TEST_DATABASE_URL;
if (testDb) contract('postgres store', () => new PgStore(testDb));
else it.skip('postgres store (set TEST_DATABASE_URL to run)', () => {});
