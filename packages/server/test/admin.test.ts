import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_IDLE_MS, ADMIN_LOCK_MS } from '../src/admin';
import { MemoryInsights } from '../src/insights';
import { hashToken, newToken } from '../src/passwords';
import { boxKey } from '../src/secretBox';
import { startServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { base32Decode, totp } from '../src/totp';
import { TestClient } from './wsClient';

type Running = Awaited<ReturnType<typeof startServer>>;
let server: Running | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const DEVICE = 'device-aaaaaaaaaaaaaaaa';

async function setup(opts: { key?: boolean } = {}) {
  const store = new MemoryStore();
  const insights = new MemoryInsights();
  const clock = { t: 1_800_000_000_000 };
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    store,
    insights,
    adminKey: opts.key === false ? null : boxKey('test-admin-key-0123456789'),
    now: () => clock.t,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const account = async (name: string, admin = false) => {
    const u = (await store.createUser(name, 'x'))!;
    const token = newToken();
    await store.createSession(hashToken(token), u.id);
    if (admin) insights.setAdmin(u.id);
    return { id: u.id, token };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, init: { token?: string; session?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.session) headers['x-admin-session'] = init.session;
    const res = await fetch(base + path, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { store, insights, clock, account, call, port: server.port };
}

/** Admin with a confirmed authenticator; returns the secret and an open admin session. */
async function adminReady(s: Awaited<ReturnType<typeof setup>>) {
  const { token } = await s.account('Boss', true);
  const setupRes = await s.call('/api/admin/setup', { token, body: {} });
  const secret = base32Decode(setupRes.body.secret);
  const confirm = await s.call('/api/admin/confirm', { token, body: { code: totp(secret, s.clock.t) } });
  return { token, secret, session: confirm.body.session as string, backupCodes: confirm.body.backupCodes as string[] };
}

const otherThan = (code: string) => (code === '123456' ? '654321' : '123456');

describe('admin API', () => {
  it('is invisible (404) to guests, normal players, and when ADMIN_KEY is missing', async () => {
    const s = await setup();
    const { token } = await s.account('Player');
    for (const path of ['/api/admin/status', '/api/admin/setup']) {
      expect((await s.call(path, { body: {} })).status).toBe(404);
      expect((await s.call(path, { token, body: {} })).status).toBe(404);
    }
    expect((await s.call('/api/admin/numbers', { token })).status).toBe(404);
    await server!.close();
    const off = await setup({ key: false });
    const boss = await off.account('Boss', true);
    expect((await off.call('/api/admin/status', { token: boss.token, body: {} })).status).toBe(404);
  });

  it('sets up the authenticator once: QR, first code, backup codes; then asks for a code', async () => {
    const s = await setup();
    const { token, id } = await s.account('Boss', true);
    expect((await s.call('/api/admin/status', { token, body: {} })).body).toEqual({ stage: 'setup', username: 'Boss' });
    const res = await s.call('/api/admin/setup', { token, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.qr).toContain('<svg');
    // The stored secret is encrypted, never the plain base32.
    const f = await s.insights.adminFactor(id);
    expect(f!.secretBox).not.toContain(res.body.secret.replace(/ /g, ''));
    const secret = base32Decode(res.body.secret);
    const wrong = await s.call('/api/admin/confirm', { token, body: { code: otherThan(totp(secret, s.clock.t)) } });
    expect(wrong).toEqual({ status: 401, body: { error: 'wrong_code', left: 4 } });
    const ok = await s.call('/api/admin/confirm', { token, body: { code: totp(secret, s.clock.t) } });
    expect(ok.status).toBe(200);
    expect(ok.body.backupCodes).toHaveLength(8);
    expect(typeof ok.body.session).toBe('string');
    // The QR is never shown again.
    expect((await s.call('/api/admin/setup', { token, body: {} })).status).toBe(409);
    expect((await s.call('/api/admin/status', { token, body: {} })).body.stage).toBe('code');
  });

  it('needs the admin session for data; a code opens it, it ends after 30 min idle', async () => {
    const s = await setup();
    const { token, secret, session } = await adminReady(s);
    expect((await s.call('/api/admin/numbers', { token })).status).toBe(401);
    expect((await s.call('/api/admin/numbers', { token, session })).status).toBe(200);
    // Another player's login with the admin's session is still 404.
    const other = await s.account('Player');
    expect((await s.call('/api/admin/numbers', { token: other.token, session })).status).toBe(404);
    s.clock.t += ADMIN_IDLE_MS - 1000;
    expect((await s.call('/api/admin/feedback', { token, session })).status).toBe(200); // use keeps it alive
    s.clock.t += ADMIN_IDLE_MS + 1;
    expect((await s.call('/api/admin/feedback', { token, session })).status).toBe(401);
    // A code that was already used does not work again; a fresh one does.
    s.clock.t += 60_000;
    const login = await s.call('/api/admin/login', { token, body: { code: totp(secret, s.clock.t) } });
    expect(login.status).toBe(200);
    expect((await s.call('/api/admin/login', { token, body: { code: totp(secret, s.clock.t) } })).status).toBe(401);
    expect((await s.call('/api/admin/numbers', { token, session: login.body.session })).status).toBe(200);
    expect((await s.call('/api/admin/logout', { token, session: login.body.session, body: {} })).status).toBe(204);
    expect((await s.call('/api/admin/numbers', { token, session: login.body.session })).status).toBe(401);
  });

  it('locks for 15 minutes after 5 wrong codes', async () => {
    const s = await setup();
    const { token, secret } = await adminReady(s);
    s.clock.t += 60_000;
    const bad = otherThan(totp(secret, s.clock.t));
    for (let i = 0; i < 4; i++) expect((await s.call('/api/admin/login', { token, body: { code: bad } })).status).toBe(401);
    const fifth = await s.call('/api/admin/login', { token, body: { code: bad } });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error).toBe('locked');
    // Even the right code is refused while locked.
    expect((await s.call('/api/admin/login', { token, body: { code: totp(secret, s.clock.t) } })).status).toBe(429);
    s.clock.t += ADMIN_LOCK_MS + 1000;
    expect((await s.call('/api/admin/login', { token, body: { code: totp(secret, s.clock.t) } })).status).toBe(200);
  });

  it('accepts each backup code once', async () => {
    const s = await setup();
    const { token, backupCodes } = await adminReady(s);
    const first = await s.call('/api/admin/login', { token, body: { code: backupCodes[0].toLowerCase() } });
    expect(first.status).toBe(200);
    expect(first.body.backupLeft).toBe(7);
    expect((await s.call('/api/admin/login', { token, body: { code: backupCodes[0] } })).status).toBe(401);
  });
});

describe('feedback', () => {
  it('only takes feedback from logged-in players, rate-limited, and the admin reads it', async () => {
    const s = await setup();
    const body = { kind: 'bug', text: 'Cards overlap', device: 'Android · Chrome', version: '0.1.0', screen: 'game', screenshot: 'data:image/jpeg;base64,AAAA' };
    expect((await s.call('/api/feedback', { body })).status).toBe(401);
    const p = await s.account('Player');
    expect((await s.call('/api/feedback', { token: p.token, body: { ...body, kind: 'rant' } })).status).toBe(400);
    expect((await s.call('/api/feedback', { token: p.token, body: { ...body, screenshot: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await s.call('/api/feedback', { token: p.token, body: { ...body, extra: 1 } })).status).toBe(400);
    expect((await s.call('/api/feedback', { token: p.token, body })).status).toBe(201);
    for (let i = 0; i < 4; i++) expect((await s.call('/api/feedback', { token: p.token, body: { ...body, screenshot: null } })).status).toBe(201);
    expect((await s.call('/api/feedback', { token: p.token, body })).status).toBe(429);

    const { token, session } = await adminReady(s);
    const list = await s.call('/api/admin/feedback', { token, session });
    expect(list.body.items).toHaveLength(5);
    const item = list.body.items.at(-1);
    expect(item).toMatchObject({ username: 'Player', kind: 'bug', text: 'Cards overlap', screen: 'game', read: false, hasScreenshot: true });
    expect(item.screenshot).toBeUndefined();
    const shot = await s.call(`/api/admin/feedback/${item.id}/screenshot`, { token, session });
    expect(shot.body.screenshot).toBe(body.screenshot);
    expect((await s.call(`/api/admin/feedback/${item.id}/read`, { token, session, body: { read: true } })).status).toBe(204);
    expect((await s.call('/api/admin/feedback', { token, session })).body.items.at(-1).read).toBe(true);
  });
});

describe('usage events', () => {
  it('records app opens and offline Bots games from the client, and refuses anything else', async () => {
    const s = await setup();
    expect((await s.call('/api/event', { body: { kind: 'open', device: DEVICE } })).status).toBe(204);
    expect((await s.call('/api/event', { body: { kind: 'game_start', device: DEVICE, mode: 'bots', game: 'local-game-1' } })).status).toBe(204);
    expect((await s.call('/api/event', { body: { kind: 'game_start', device: DEVICE, mode: 'ranked', game: 'local-game-1' } })).status).toBe(400);
    expect((await s.call('/api/event', { body: { kind: 'signup', device: DEVICE } })).status).toBe(400);
    expect((await s.call('/api/event', { body: { kind: 'open', device: 'x' } })).status).toBe(400);
    const kinds = (await s.insights.events(0)).map((e) => [e.kind, e.mode ?? null]);
    expect(kinds).toEqual([
      ['open', null],
      ['game_start', 'bots'],
    ]);
  });

  it('counts signups and logins over the socket with the device id', async () => {
    const s = await setup();
    const c = await TestClient.connect(s.port, `/?d=${DEVICE}`);
    c.send({ t: 'signup', username: 'Newbie', password: 'secret1' });
    await c.waitFor('account');
    c.close();
    await new Promise((r) => setTimeout(r, 20));
    const evs = await s.insights.events(0);
    expect(evs.map((e) => e.kind).sort()).toEqual(['active', 'signup']);
    expect(evs.every((e) => e.device === DEVICE && e.userId !== null)).toBe(true);
  });
});
