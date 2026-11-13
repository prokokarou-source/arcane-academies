import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/server';
import type { ManagerOptions } from '../src/manager';
import { keyOf, TestClient } from './wsClient';

type Running = Awaited<ReturnType<typeof startServer>>;
let server: Running | null = null;
const clients: TestClient[] = [];

async function boot(manager: Partial<ManagerOptions> = {}) {
  server = await startServer({ port: 0, host: '127.0.0.1', manager });
  return server.port;
}
async function client(port: number) {
  const c = await TestClient.connect(port);
  clients.push(c);
  return c;
}

/** Host creates a room, a second client joins, host starts a 2-player game. */
async function twoPlayerGame(port: number) {
  const a = await client(port);
  a.send({ t: 'create', name: 'Ana' });
  const { code } = await a.waitFor('joined');
  const b = await client(port);
  b.send({ t: 'join', code, name: 'Bob' });
  const joinedB = await b.waitFor('joined');
  await a.waitFor('lobby', (m) => m.lobby.seats.length === 2);
  a.send({ t: 'start' });
  await a.waitFor('game');
  await b.waitFor('game');
  return { a, b, code, tokenB: joinedB.token };
}

/** Per (term/turn/phase): the hand uids this client saw for itself, and the raw text it received. */
function byTurn(c: TestClient) {
  const hands = new Map<string, Set<string>>();
  const raw = new Map<string, string>();
  c.messages.forEach((m, i) => {
    if (m.t !== 'game') return;
    const k = keyOf(m);
    const set = hands.get(k) ?? new Set<string>();
    for (const card of m.view.players[m.view.me].hand ?? []) set.add(card.uid);
    hands.set(k, set);
    raw.set(k, (raw.get(k) ?? '') + c.raw[i]);
  });
  return { hands, raw };
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await server?.close();
  server = null;
});

describe('websocket server', () => {
  it('two clients play a full 2-player game over the wire', async () => {
    const port = await boot();
    const { a, b } = await twoPlayerGame(port);
    const [ea, eb] = await Promise.all([a.playToEnd(), b.playToEnd()]);
    expect(ea.result!.winners).toEqual(eb.result!.winners);
    expect(ea.view.players).toHaveLength(3);
    expect(ea.result!.winners).not.toContain(1);
  });

  it('never sends hidden information over the wire', async () => {
    const port = await boot();
    const { a, b } = await twoPlayerGame(port);
    await Promise.all([a.playToEnd(), b.playToEnd()]);
    for (const c of [a, b]) {
      for (const raw of c.raw) for (const k of ['"rngState":', '"seed":', '"pending":', '"towerCards":']) expect(raw).not.toContain(k);
    }
    let compared = 0;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const seen = byTurn(x).raw;
      const secret = byTurn(y).hands;
      for (const [k, text] of seen) {
        for (const uid of secret.get(k) ?? []) {
          expect(text).not.toContain(`"${uid}"`);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('lets a player rejoin with their token after the socket dropped', async () => {
    const port = await boot();
    const { a, b, code, tokenB } = await twoPlayerGame(port);
    const handBefore = b.latestGame()!.view.players[2].hand;
    b.close();
    await a.waitFor('game', (g) => !g.seats[2].connected);
    const b2 = await client(port);
    b2.send({ t: 'rejoin', code: code.toLowerCase(), token: tokenB });
    await b2.waitFor('joined');
    const g = await b2.waitFor('game');
    expect(g.view.me).toBe(2);
    expect(g.view.players[2].hand).toEqual(handBefore);
    const [ea] = await Promise.all([a.playToEnd(), b2.playToEnd()]);
    expect(ea.result).toBeDefined();
  });

  it('lets a bot take over a seat after the grace period', async () => {
    const port = await boot({ defaultSettings: { graceMs: 50 } });
    const { a, b } = await twoPlayerGame(port);
    b.close();
    const end = await a.playToEnd();
    expect(end.result).toBeDefined();
    expect(end.seats[2]).toMatchObject({ connected: false, botControlled: true });
  });

  it('survives garbage and oversized frames', async () => {
    const port = await boot();
    const c = await client(port);
    c.send('{{{');
    expect((await c.waitFor('error')).code).toBe('bad_message');
    c.send({ t: 'start' });
    expect((await c.waitFor('error', (e) => e.code === 'not_in_room')).code).toBe('not_in_room');
    const big = await client(port);
    big.send(JSON.stringify({ t: 'create', name: 'x'.repeat(20_000) }));
    await expect(big.waitFor('joined', () => true, 0, 2000)).rejects.toThrow(/closed/);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rooms: 0 });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });
});
