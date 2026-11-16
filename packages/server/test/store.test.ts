import { afterAll, describe, expect, it } from 'vitest';
import { hashPassword, hashToken, newToken, verifyPassword } from '../src/passwords';
import { PgStore } from '../src/pgStore';
import { MemoryStore, type Store } from '../src/store';

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
  });
}

contract('memory store', () => new MemoryStore());

// Runs against a real database only when one is provided (never the production one).
const testDb = process.env.TEST_DATABASE_URL;
if (testDb) contract('postgres store', () => new PgStore(testDb));
else it.skip('postgres store (set TEST_DATABASE_URL to run)', () => {});
