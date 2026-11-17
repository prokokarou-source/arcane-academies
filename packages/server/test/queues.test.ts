import { describe, expect, it } from 'vitest';
import type { Queue, QueueKind } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { RoomManager, type ManagerOptions } from '../src/manager';
import type { Conn } from '../src/room';
import type { GameRecord } from '../src/store';
import { FakeConn } from './fakes';

const SEC = 1000;

function setup(opts: Partial<ManagerOptions> = {}) {
  const clock = new ManualClock(1_000_000);
  const records: GameRecord[][] = [];
  const mgr = new RoomManager(
    { clientUrl: 'http://client', seed: () => 7, quickStartMs: 10 * SEC, onResults: (r) => records.push(r), ...opts },
    clock,
  );
  const queue = (name: string, queue: Queue = '1v1', kind: QueueKind = 'casual') => {
    const c = new FakeConn(name);
    mgr.onMessage(c, { t: 'queueJoin', kind, queue, name });
    return c;
  };
  const many = (n: number, q: Queue, kind: QueueKind = 'casual') => Array.from({ length: n }, (_, i) => queue(`P${i}`, q, kind));
  const sameRoom = (cs: FakeConn[]) => cs.every((c) => c.last('joined') && c.last('joined')!.code === cs[0].last('joined')!.code);
  return { clock, mgr, queue, many, sameRoom, records };
}

/** Logged-in accounts: the conn's label is its account id. */
const accountOf = (c: Conn) => ((c as FakeConn).label.startsWith('guest') ? null : (c as FakeConn).label);

describe('queues', () => {
  it('1v1 matches two humans; the table gets the Archmage, random academies and one random side', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana');
    expect(a.last('queueState')).toEqual({ t: 'queueState', kind: 'casual', queue: '1v1', searching: 1, waitedMs: 0 });
    clock.advance(3 * SEC);
    const b = queue('Bob');
    expect(mgr.searching()).toBe(0);
    expect(b.last('joined')!.code).toBe(a.last('joined')!.code);
    const lobby = b.last('lobby')!.lobby;
    expect(lobby).toMatchObject({ kind: 'casual', queue: '1v1', quick: true, startsAt: clock.now() + 10 * SEC });
    expect(lobby.seats.map((s) => s.name)).toEqual(['Ana', 'Bob']);
    // Academies are drawn, not picked; nobody can kick a stranger.
    mgr.onMessage(b, { t: 'setSeat', academyId: 'pyromancy' });
    expect(b.lastError()).toBe('wrong_phase');
    mgr.onMessage(a, { t: 'removeSeat', seatId: lobby.seats[1].id });
    expect(a.lastError()).toBe('wrong_phase');
    mgr.onMessage(a, { t: 'roomConfig', settings: { bots: 1 } });
    expect(a.lastError()).toBe('wrong_phase');
    clock.advance(10 * SEC);
    const game = a.last('game')!;
    expect(game.seats.map((s) => s.kind)).toEqual(['human', 'archmage', 'human']);
    expect(game.reveal!.academies).toHaveLength(3);
    const room = mgr.room(lobby.code)!;
    expect(new Set(room.state!.players.map((p) => p.side))).toEqual(new Set([game.reveal!.side]));
  });

  it('3-5 starts at five, or with three or more after 45 s', () => {
    const { mgr, clock, many, sameRoom, queue } = setup();
    const four = many(4, '3-5');
    expect(mgr.searching()).toBe(4);
    expect(four[0].last('queueState')!.searching).toBe(4);
    const fifth = queue('Eve', '3-5');
    expect(sameRoom([...four, fifth])).toBe(true);
    expect(fifth.last('lobby')!.lobby.seats).toHaveLength(5);

    const three = many(3, '3-5');
    clock.advance(44 * SEC);
    expect(mgr.searching()).toBe(3);
    clock.advance(1 * SEC);
    expect(mgr.searching()).toBe(0);
    expect(sameRoom(three)).toBe(true);
    // No bots fill queue tables.
    clock.advance(10 * SEC);
    expect(three[0].last('game')!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'human']);

    const two = many(2, '3-5');
    clock.advance(120 * SEC);
    expect(two[0].last('joined')).toBeUndefined();
    expect(mgr.searching()).toBe(2);
  });

  it('6-7 starts at seven, or with six after 60 s', () => {
    const { mgr, clock, many, sameRoom } = setup();
    const seven = many(7, '6-7');
    expect(sameRoom(seven)).toBe(true);
    const six = many(6, '6-7');
    clock.advance(59 * SEC);
    expect(mgr.searching()).toBe(6);
    clock.advance(1 * SEC);
    expect(sameRoom(six)).toBe(true);
    expect(six[0].last('lobby')!.lobby.seats).toHaveLength(6);
  });

  it('keeps queues and kinds apart', () => {
    const { mgr, queue } = setup({ accountOf });
    const a = queue('Ana', '1v1', 'casual');
    const b = queue('Bob', '1v1', 'ranked');
    const c = queue('Cy', '3-5', 'casual');
    expect(mgr.searching()).toBe(3);
    expect(a.last('queueState')!.searching).toBe(1);
    expect(b.last('queueState')).toMatchObject({ kind: 'ranked', searching: 1 });
    expect(c.last('queueState')).toMatchObject({ queue: '3-5', searching: 1 });
  });

  it('ranked needs a login and never seats one account twice', () => {
    const { mgr, queue } = setup({ accountOf });
    const g = queue('guest1', '1v1', 'ranked');
    expect(g.lastError()).toBe('not_logged_in');
    expect(mgr.searching()).toBe(0);
    const a1 = queue('acc-a', '1v1', 'ranked');
    const a2 = queue('acc-a', '1v1', 'ranked');
    expect(mgr.searching()).toBe(2);
    expect(a2.last('joined')).toBeUndefined();
    const b = queue('acc-b', '1v1', 'ranked');
    expect(b.last('joined')!.code).toBe(a1.last('joined')!.code);
    expect(b.last('lobby')!.lobby.kind).toBe('ranked');
    // Guests may play casual.
    expect(queue('guest2').lastError()).toBeUndefined();
  });

  it('hands kind, queue and side to onResults', () => {
    const { mgr, clock, queue, records } = setup({ accountOf });
    const a = queue('acc-a', '1v1', 'ranked');
    const b = queue('acc-b', '1v1', 'ranked');
    clock.advance(10 * SEC);
    const room = mgr.room(a.last('joined')!.code)!;
    for (let i = 0; i < 5000 && room.state!.phase !== 'ended'; i++) {
      const c = [a, b].find((x) => (x.last('game')?.legal.length ?? 0) > 0)!;
      mgr.onMessage(c, { t: 'act', action: c.last('game')!.legal[0] });
    }
    expect(records).toHaveLength(1);
    const side = room.state!.players[0].side;
    for (const r of records[0]) expect(r).toMatchObject({ kind: 'ranked', queue: '1v1', side, players: 2 });
    // Game messages say it is ranked, and a ranked table cannot be replayed: back to the menu.
    expect(a.last('game')!.kind).toBe('ranked');
    for (const t of ['rematch', 'playAgainNow'] as const) {
      mgr.onMessage(a, { t });
      expect(a.lastError()).toBe('wrong_phase');
    }
    mgr.onMessage(b, { t: 'playAgain', ready: true });
    expect(b.lastError()).toBe('wrong_phase');
    expect(room.state!.phase).toBe('ended');
  });

  it('queueLeave and disconnect remove a player; entering a room ends the search', () => {
    const { mgr, queue } = setup();
    const a = queue('Ana', '3-5');
    const b = queue('Bob', '3-5');
    mgr.onMessage(a, { t: 'queueLeave' });
    expect(a.last('queueLeft')).toBeDefined();
    expect(b.last('queueState')!.searching).toBe(1);
    mgr.onMessage(a, { t: 'queueLeave' });
    expect(a.sent.filter((m) => m.t === 'queueLeft')).toHaveLength(1);
    mgr.onClose(b);
    expect(mgr.searching()).toBe(0);
    const c = queue('Cy', '3-5');
    mgr.onMessage(c, { t: 'create', name: 'Cy' });
    expect(mgr.searching()).toBe(0);
    expect(mgr.codeOf(c)).not.toBeNull();
    mgr.onMessage(c, { t: 'queueJoin', kind: 'casual', queue: '1v1', name: 'Cy' });
    expect(mgr.codeOf(c)).toBeNull();
    expect(mgr.searching()).toBe(1);
  });

  it('a 1v1 whose opponent leaves during the countdown closes instead of starting alone', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana');
    const b = queue('Bob');
    mgr.onMessage(a, { t: 'leave' });
    expect(b.last('lobby')!.lobby.seats).toHaveLength(1);
    clock.advance(10 * SEC);
    expect(b.last('game')).toBeUndefined();
    expect(b.closedWith).toBe('left');
    mgr.sweep();
    expect(mgr.size()).toBe(0);
  });
});
