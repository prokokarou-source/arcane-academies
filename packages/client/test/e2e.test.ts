// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '@arcane/server';
import { GameClient, type ClientState, type SocketLike } from '../src/net/client';
import { memoryStorage } from './fakeSocket';

let server: RunningServer;
beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' });
});
afterAll(() => server.close());

function makeClient(storage = memoryStorage()) {
  const client = new GameClient({
    url: `ws://127.0.0.1:${server.port}`,
    createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
    storage,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
  });
  client.start();
  return { client, storage };
}

function waitUntil(client: GameClient, pred: (s: ClientState) => boolean, timeoutMs = 20_000): Promise<ClientState> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const s = client.getState();
      if (!pred(s)) return false;
      off();
      clearTimeout(timer);
      resolve(s);
      return true;
    };
    const off = client.subscribe(check);
    const timer = setTimeout(() => {
      off();
      reject(new Error('timed out; state: ' + JSON.stringify({ ...client.getState(), game: !!client.getState().game })));
    }, timeoutMs);
    check();
  });
}

describe('client against the real server', () => {
  it('plays a solo game against bots to the end', async () => {
    const { client } = makeClient();
    client.solo('Ana', 2, 'easy');
    // Act with the first legal action whenever offered, like a player tapping quickly.
    const off = client.subscribe(() => {
      const s = client.getState();
      if (s.game && s.game.legal.length > 0 && !s.acting && !s.game.result) client.act(s.game.legal[0]);
      if (s.duels) client.clearDuels();
    });
    const end = await waitUntil(client, (s) => !!s.game?.result);
    off();
    expect(end.game!.result!.scores).toHaveLength(3);
    expect(end.game!.result!.winners.length).toBeGreaterThan(0);
    expect(end.game!.view.phase).toBe('ended');
    client.stop();
  }, 30_000);

  it('reloads mid-game and rejoins', async () => {
    const first = makeClient();
    first.client.solo('Bea', 3, 'easy');
    const g = await waitUntil(first.client, (s) => !!s.game);
    const me = g.game!.view.me;
    const seatId = g.seatId;
    first.client.stop();

    const second = makeClient(first.storage);
    const back = await waitUntil(second.client, (s) => !!s.game);
    expect(back.game!.view.me).toBe(me);
    expect(back.seatId).toBe(seatId);
    second.client.stop();
  });

  it('a stale session lands on home with a notice', async () => {
    const storage = memoryStorage();
    storage.setItem('arcane.session', JSON.stringify({ code: 'NOPE-99', token: 'x'.repeat(32) }));
    const { client } = makeClient(storage);
    const s = await waitUntil(client, (x) => x.notice !== null);
    expect(s.notice).toBe('rejoinFailed');
    expect(storage.data.size).toBe(0);
    client.stop();
  });
});
