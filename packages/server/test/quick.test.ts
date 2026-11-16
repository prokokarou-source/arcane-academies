import { describe, expect, it } from 'vitest';
import type { QuickSize } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { RoomManager } from '../src/manager';
import { FakeConn } from './fakes';

const SEC = 1000;

function setup() {
  const clock = new ManualClock(1_000_000);
  const mgr = new RoomManager({ clientUrl: 'http://client', seed: () => 7, quickStartMs: 10 * SEC, quickFillMs: 45 * SEC }, clock);
  const queue = (name: string, size: QuickSize) => {
    const c = new FakeConn(name);
    mgr.onMessage(c, { t: 'quickMatch', name, size });
    return c;
  };
  return { clock, mgr, queue };
}

describe('quick match', () => {
  it('matches two players who want 2 into one room that starts by itself', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana', 2);
    expect(a.last('quickQueue')).toMatchObject({ size: 2, searching: 1, waitedMs: 0 });
    expect(mgr.size()).toBe(0);
    clock.advance(3 * SEC);
    const b = queue('Bob', 2);
    expect(mgr.searching()).toBe(0);
    const code = a.last('joined')!.code;
    expect(b.last('joined')!.code).toBe(code);
    const lobby = b.last('lobby')!.lobby;
    expect(lobby.quick).toBe(true);
    expect(lobby.startsAt).toBe(clock.now() + 10 * SEC);
    expect(lobby.seats.map((s) => s.name)).toEqual(['Ana', 'Bob']);
    // Players may pick academies during the countdown, but the host cannot start or kick.
    mgr.onMessage(b, { t: 'setSeat', academyId: 'pyromancy' });
    expect(a.last('lobby')!.lobby.seats[1].academyId).toBe('pyromancy');
    mgr.onMessage(a, { t: 'removeSeat', seatId: lobby.seats[1].id });
    expect(a.lastError()).toBe('wrong_phase');
    clock.advance(10 * SEC);
    expect(a.last('game')!.seats.filter((s) => s.kind === 'human')).toHaveLength(2);
    expect(b.last('game')!.view.players[b.last('game')!.view.me].academyId).toBe('pyromancy');
  });

  it('keeps sizes apart and lets "any" join the first full table', () => {
    const { mgr, queue } = setup();
    const a = queue('Ana', 3);
    const b = queue('Bob', 2);
    expect(mgr.searching()).toBe(2);
    expect(b.last('quickQueue')!.searching).toBe(2);
    const c = queue('Cy', null);
    // Cy completes Bob's table of 2 (largest full table first: none of 3 or 4 yet).
    expect(c.last('joined')!.code).toBe(b.last('joined')!.code);
    expect(a.last('joined')).toBeUndefined();
    expect(a.last('quickQueue')!.searching).toBe(1);
    const d = queue('Di', 3);
    const e = queue('Ed', 3);
    expect(d.last('joined')!.code).toBe(a.last('joined')!.code);
    expect(e.last('lobby')!.lobby.seats).toHaveLength(3);
    expect(mgr.searching()).toBe(0);
  });

  it('players open to any size wait for four', () => {
    const { mgr, queue } = setup();
    const conns = ['A', 'B', 'C'].map((n) => queue(n, null));
    expect(mgr.searching()).toBe(3);
    const d = queue('D', 4);
    expect(d.last('lobby')!.lobby.seats).toHaveLength(4);
    expect(conns.every((c) => c.last('joined')?.code === d.last('joined')!.code)).toBe(true);
  });

  it('after the timeout starts with who is there and fills the table with Normal bots', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana', 4);
    clock.advance(20 * SEC);
    const b = queue('Bob', null);
    expect(mgr.searching()).toBe(2);
    clock.advance(25 * SEC);
    expect(mgr.searching()).toBe(0);
    expect(b.last('joined')!.code).toBe(a.last('joined')!.code);
    expect(a.last('lobby')!.lobby.seats).toHaveLength(2);
    clock.advance(10 * SEC);
    const seats = a.last('game')!.seats;
    expect(seats).toHaveLength(4);
    expect(seats.filter((s) => s.kind === 'bot')).toHaveLength(2);
  });

  it('a lone player keeps waiting and can switch to bots', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana', 3);
    clock.advance(90 * SEC);
    expect(mgr.searching()).toBe(1);
    expect(a.last('joined')).toBeUndefined();
    // Someone incompatible does not rescue the wait.
    const b = queue('Bob', 2);
    expect(mgr.searching()).toBe(2);
    mgr.onMessage(a, { t: 'quickBots' });
    expect(mgr.searching()).toBe(1);
    expect(b.last('quickQueue')!.searching).toBe(1);
    expect(a.last('lobby')!.lobby.seats).toHaveLength(1);
    clock.advance(10 * SEC);
    expect(a.last('game')!.seats.filter((s) => s.kind === 'bot')).toHaveLength(2);
    mgr.onMessage(a, { t: 'quickBots' });
    expect(a.lastError()).toBe('wrong_phase');
  });

  it('cancel and disconnect remove a player from the queue', () => {
    const { mgr, queue } = setup();
    const a = queue('Ana', 2);
    const b = queue('Bob', 3);
    mgr.onMessage(a, { t: 'quickCancel' });
    expect(a.last('quickCancelled')).toBeDefined();
    expect(b.last('quickQueue')!.searching).toBe(1);
    mgr.onClose(b);
    expect(mgr.searching()).toBe(0);
    const c = queue('Cy', 2);
    expect(c.last('joined')).toBeUndefined();
    expect(mgr.size()).toBe(0);
  });

  it('creating a room ends the search; searching again leaves the room', () => {
    const { mgr, queue } = setup();
    const a = queue('Ana', 2);
    mgr.onMessage(a, { t: 'create', name: 'Ana' });
    expect(mgr.searching()).toBe(0);
    expect(mgr.codeOf(a)).not.toBeNull();
    mgr.onMessage(a, { t: 'quickMatch', name: 'Ana', size: 2 });
    expect(mgr.codeOf(a)).toBeNull();
    expect(mgr.searching()).toBe(1);
  });

  it('when everyone leaves during the countdown the room closes', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana', 2);
    const b = queue('Bob', 2);
    mgr.onMessage(a, { t: 'leave' });
    expect(b.last('lobby')!.lobby.seats).toHaveLength(1);
    mgr.onMessage(b, { t: 'leave' });
    clock.advance(10 * SEC);
    expect(b.last('game')).toBeUndefined();
    mgr.sweep();
    expect(mgr.size()).toBe(0);
  });
});
