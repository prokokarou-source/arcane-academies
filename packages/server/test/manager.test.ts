import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock';
import { RoomManager } from '../src/manager';
import { FakeConn } from './fakes';

const MIN = 60_000;

function setup() {
  const clock = new ManualClock(1_000_000);
  const mgr = new RoomManager({ clientUrl: 'http://client', idleMs: 30 * MIN, sweepMs: MIN }, clock);
  return { clock, mgr };
}

describe('RoomManager', () => {
  it('creates rooms and joins them by code, case-insensitively', () => {
    const { mgr } = setup();
    const a = new FakeConn();
    mgr.onMessage(a, { t: 'create', name: 'Ana' });
    const code = a.last('joined')!.code;
    expect(code).toMatch(/^[A-Z]{4}-[1-9]\d$/);
    expect(mgr.size()).toBe(1);
    const b = new FakeConn();
    mgr.onMessage(b, { t: 'join', code: ` ${code.toLowerCase()} `, name: 'Bob' });
    expect(b.last('lobby')!.lobby.seats).toHaveLength(2);
    mgr.onMessage(b, { t: 'setSeat', side: 'B' });
    expect(a.last('lobby')!.lobby.seats[1].side).toBe('B');
  });

  it('reports unknown rooms and conns outside a room', () => {
    const { mgr } = setup();
    const c = new FakeConn();
    mgr.onMessage(c, { t: 'join', code: 'NOPE-11', name: 'X' });
    expect(c.lastError()).toBe('no_room');
    mgr.onMessage(c, { t: 'rejoin', code: 'NOPE-11', token: 'x' });
    expect(c.lastError()).toBe('no_room');
    mgr.onMessage(c, { t: 'start' });
    expect(c.lastError()).toBe('not_in_room');
  });

  it('rejoins through the manager after the socket closed', () => {
    const { mgr } = setup();
    const a = new FakeConn();
    mgr.onMessage(a, { t: 'create', name: 'Ana' });
    const { code, token } = a.last('joined')!;
    mgr.onMessage(a, { t: 'addBot', level: 'easy' });
    mgr.onMessage(a, { t: 'start' });
    mgr.onClose(a);
    const a2 = new FakeConn();
    mgr.onMessage(a2, { t: 'rejoin', code, token });
    expect(a2.last('game')!.view.me).toBe(0);
    mgr.onMessage(a2, { t: 'act', action: a2.last('game')!.legal[0] });
    expect(a2.last('game')!.view.turn).toBe(2);
  });

  it('moves a conn out of its old room when it creates or joins another', () => {
    const { mgr } = setup();
    const a = new FakeConn();
    const b = new FakeConn();
    mgr.onMessage(a, { t: 'create', name: 'Ana' });
    const code = a.last('joined')!.code;
    mgr.onMessage(b, { t: 'join', code, name: 'Bob' });
    mgr.onMessage(b, { t: 'create', name: 'Bob' });
    expect(a.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana']);
    expect(mgr.size()).toBe(2);
  });

  it('expires idle rooms and keeps active ones', () => {
    const { mgr, clock } = setup();
    const a = new FakeConn();
    const b = new FakeConn();
    mgr.onMessage(a, { t: 'create', name: 'Ana' });
    mgr.onMessage(b, { t: 'create', name: 'Bob' });
    for (let i = 0; i < 6; i++) {
      clock.advance(10 * MIN);
      mgr.onMessage(b, { t: 'setSeat', side: i % 2 ? 'A' : 'B' });
    }
    expect(a.closedWith).toBe('expired');
    expect(b.closedWith).toBeNull();
    expect(mgr.size()).toBe(1);
  });

  it('drops rooms that closed because everyone left', () => {
    const { mgr, clock } = setup();
    const a = new FakeConn();
    mgr.onMessage(a, { t: 'create', name: 'Ana' });
    mgr.onMessage(a, { t: 'leave' });
    clock.advance(MIN);
    expect(mgr.size()).toBe(0);
    mgr.stop();
  });
});
