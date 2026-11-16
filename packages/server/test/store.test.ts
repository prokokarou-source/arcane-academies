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
      expect(await store.findUser(n('ana'))).toEqual({ ...ana, passHash: 'h1' });
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
  });
}

contract('memory store', () => new MemoryStore());

// Runs against a real database only when one is provided (never the production one).
const testDb = process.env.TEST_DATABASE_URL;
if (testDb) contract('postgres store', () => new PgStore(testDb));
else it.skip('postgres store (set TEST_DATABASE_URL to run)', () => {});
