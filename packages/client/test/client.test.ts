import { describe, expect, it } from 'vitest';
import type { LobbyState } from '@arcane/protocol';
import { harness, memoryStorage } from './fakeSocket';
import { gameMsg, makeGame } from './views';

const lobby = (seats = 1, hostId = 's1'): LobbyState => ({
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId,
  seats: Array.from({ length: seats }, (_, i) => ({ id: 's' + (i + 1), kind: 'human' as const, name: 'P' + i, academyId: null, side: 'A' as const, connected: true })),
  settings: { graceMs: 60_000, turnTimerMs: null },
});

const CLOSES = [
  [4001, 'replaced'],
  [4002, 'expired'],
] as const;

describe('GameClient', () => {
  it('queues create until open, then sends it', () => {
    const h = harness();
    h.client.start();
    h.client.create('Ana');
    expect(h.sock().sent).toEqual([]);
    h.sock().open();
    expect(h.sock().sent).toEqual([{ t: 'create', name: 'Ana' }]);
    expect(h.client.getState().conn).toBe('open');
  });

  it('saves the session on joined and rejoins with the stored token on open', () => {
    const storage = memoryStorage();
    const h = harness(storage);
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    expect(h.client.getState()).toMatchObject({ code: 'WAND-42', seatId: 's1' });
    h.client.stop();

    const h2 = harness(storage);
    h2.client.start();
    h2.sock().open();
    expect(h2.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }]);
  });

  for (const [code, notice] of CLOSES) {
    it('clears the session and sets notice on close ' + code + ' and does not rejoin', () => {
      const h = harness();
      h.client.start();
      h.sock().open();
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
      h.sock().receive({ t: 'lobby', lobby: lobby() });
      h.sock().serverClose(code);
      expect(h.storage.data.size).toBe(code === 4001 ? 1 : 0);
      expect(h.client.getState()).toMatchObject({ notice, lobby: null, game: null, seatId: null });
      h.runTimers();
      h.sock().open();
      expect(h.sock().sent).toEqual([]);
    });
  }

  it('reconnects with backoff after an unexpected close', () => {
    const h = harness();
    h.client.start();
    h.sock().serverClose(1006);
    expect(h.client.getState().conn).toBe('reconnecting');
    expect(h.timers.map((t) => t.ms)).toEqual([500]);
    h.runTimers();
    h.sock().serverClose(1006);
    expect(h.timers.map((t) => t.ms)).toEqual([1000]);
    h.runTimers();
    h.sock().open();
    h.sock().serverClose(1006);
    expect(h.timers.map((t) => t.ms)).toEqual([500]);
    expect(h.sockets).toHaveLength(3);
  });

  it('caps the backoff at 8 s', () => {
    const h = harness();
    h.client.start();
    for (let i = 0; i < 8; i++) {
      h.sock().serverClose(1006);
      if (i < 7) h.runTimers();
    }
    expect(h.timers.map((t) => t.ms)).toEqual([8000]);
  });

  it('drops a dead session when rejoin is refused', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.session', JSON.stringify({ code: 'GONE-11', token: 't' }));
    const h = harness(storage);
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'error', code: 'no_room', message: 'No such room' });
    expect(storage.data.size).toBe(0);
    expect(h.client.getState()).toMatchObject({ notice: 'rejoinFailed', error: null });
  });

  it('ignores a corrupt stored session', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.session', '{oops');
    const h = harness(storage);
    h.client.start();
    h.sock().open();
    expect(h.sock().sent).toEqual([]);
  });

  it('closed left clears lobby and session but keeps the socket', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h.sock().receive({ t: 'lobby', lobby: lobby() });
    h.client.leave();
    h.sock().receive({ t: 'closed', reason: 'left' });
    expect(h.client.getState()).toMatchObject({ lobby: null, notice: 'left', conn: 'open' });
    expect(h.storage.data.size).toBe(0);
    expect(h.sockets).toHaveLength(1);
  });

  it('sends one act per turn', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    const g = gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0);
    h.sock().receive(g);
    h.client.act(g.legal[0]);
    h.client.act(g.legal[1]);
    expect(h.sock().sent.filter((m) => m.t === 'act')).toHaveLength(1);
    expect(h.client.getState().acting).toBe(true);
    h.sock().receive(g);
    expect(h.client.getState().acting).toBe(false);
    h.client.act(g.legal[1]);
    expect(h.sock().sent.filter((m) => m.t === 'act')).toHaveLength(2);
  });

  it('an error releases the act lock', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    const g = gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0);
    h.sock().receive(g);
    h.client.act(g.legal[0]);
    h.sock().receive({ t: 'error', code: 'illegal_action', message: 'nope' });
    expect(h.client.getState()).toMatchObject({ acting: false, error: { code: 'illegal_action' } });
  });

  it('solo adds bots and starts', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.client.solo('Ana', 3, 'hard');
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h.sock().receive({ t: 'lobby', lobby: lobby(1) });
    h.sock().receive({ t: 'lobby', lobby: lobby(2) });
    expect(h.sock().sent).toEqual([
      { t: 'create', name: 'Ana' },
      { t: 'addBot', level: 'hard' },
      { t: 'addBot', level: 'hard' },
      { t: 'addBot', level: 'hard' },
      { t: 'start' },
    ]);
  });

  it('keeps the previous view and the host id for the game', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'lobby', lobby: lobby(3, 's2') });
    const s = makeGame(['Ana', 'Bob', 'Cleo']);
    const a = gameMsg(s, 0);
    const b = gameMsg(s, 0);
    h.sock().receive(a);
    expect(h.client.getState().prevView).toBeNull();
    h.sock().receive(b);
    expect(h.client.getState().prevView).toEqual(a.view);
    expect(h.client.getState().hostId).toBe('s2');
  });

  it('notifies subscribers until they unsubscribe', () => {
    const h = harness();
    let calls = 0;
    const off = h.client.subscribe(() => calls++);
    h.client.start();
    h.sock().open();
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    h.sock().receive({ t: 'lobby', lobby: lobby() });
    expect(calls).toBe(before);
  });
  it('records Term duels until they are cleared, even when more turns follow', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    const g = gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0);
    const after = { ...g, view: { ...g.view, term: 2 as const, duelTokens: [[1, -1], [], []] } };
    h.sock().receive(g);
    h.sock().receive(after);
    h.sock().receive(after);
    expect(h.client.getState().duels).toMatchObject({ term: 1, deltas: [1, -1] });
    h.client.clearDuels();
    expect(h.client.getState().duels).toBeNull();
  });
  it('replaced keeps the stored session for the tab that took the seat', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h.sock().serverClose(4001);
    expect(h.storage.getItem('arcane.session')).toContain('tok');
    h.sock().open();
    expect(h.sock().sent).toEqual([]);
  });

  it('rejoins from memory on reconnect even if another tab cleared storage', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h.storage.removeItem('arcane.session');
    h.sock().serverClose(1006);
    h.runTimers();
    h.sock().open();
    expect(h.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }]);
  });

  it('reads storage only at start, so a session written by another tab is not stolen on reconnect', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.storage.setItem('arcane.session', JSON.stringify({ code: 'WAND-42', token: 'other' }));
    h.sock().serverClose(1006);
    h.runTimers();
    h.sock().open();
    expect(h.sock().sent).toEqual([]);
  });

  it('restores the host id after a reload', () => {
    const storage = memoryStorage();
    const h = harness(storage);
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h.sock().receive({ t: 'lobby', lobby: lobby(2, 's1') });
    h.client.stop();
    const h2 = harness(storage);
    h2.client.start();
    h2.sock().open();
    h2.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h2.sock().receive(gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0));
    expect(h2.client.getState().hostId).toBe('s1');
  });
  it('holds queued moves while a rejoin is pending and drops them if the seat is gone', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.session', JSON.stringify({ code: 'WAND-42', token: 'tok' }));
    const h = harness(storage);
    h.client.start();
    expect(h.client.getState().restoring).toBe(true);
    h.sock().open();
    h.client.create('Ana');
    expect(h.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }]);
    h.sock().receive({ t: 'error', code: 'no_room', message: 'x' });
    expect(h.client.getState().restoring).toBe(false);
    expect(h.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }, { t: 'create', name: 'Ana' }]);
  });

  it('drops queued moves for a room that is gone, keeps create and join', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    const g = gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0);
    h.sock().receive(g);
    h.sock().serverClose(1006);
    h.client.act(g.legal[0]);
    h.client.join('MOON-11', 'Ana');
    h.runTimers();
    h.sock().open();
    h.sock().receive({ t: 'error', code: 'bad_token', message: 'x' });
    expect(h.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }, { t: 'join', code: 'MOON-11', name: 'Ana' }]);
  });

  it('flushes held moves after a successful rejoin', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    h.sock().serverClose(1006);
    h.client.leave();
    h.runTimers();
    h.sock().open();
    expect(h.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }]);
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 'tok' });
    expect(h.sock().sent).toEqual([{ t: 'rejoin', code: 'WAND-42', token: 'tok' }, { t: 'leave' }]);
  });
});
