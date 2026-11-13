import { describe, expect, it } from 'vitest';
import { FakeConn, lobbyWith } from './fakes';

describe('room lobby', () => {
  it('makes the first joiner host and broadcasts the same lobby to everyone', () => {
    const { conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    expect(a.last('joined')!.token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.last('joined')!.token).not.toBe(b.last('joined')!.token);
    const lobby = a.last('lobby')!.lobby;
    expect(lobby).toEqual(b.last('lobby')!.lobby);
    expect(lobby.hostId).toBe(a.last('joined')!.seatId);
    expect(lobby.code).toBe('WAND-42');
    expect(lobby.inviteUrl).toBe('http://client/?room=WAND-42');
    expect(lobby.seats.map((s) => [s.name, s.kind, s.connected])).toEqual([
      ['Ana', 'human', true],
      ['Bob', 'human', true],
    ]);
    expect(lobby.settings).toEqual({ graceMs: 60_000, turnTimerMs: null });
  });

  it('rejects host-only messages from others', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    const botId = a.last('lobby')!.lobby.seats[2].id;
    const before = JSON.stringify(a.last('lobby'));
    for (const msg of [
      { t: 'addBot', level: 'hard' },
      { t: 'removeSeat', seatId: botId },
      { t: 'setBotLevel', seatId: botId, level: 'hard' },
      { t: 'settings', settings: { turnTimerMs: 30_000 } },
      { t: 'start' },
    ] as const) {
      room.handle(b, msg);
      expect(b.lastError(), msg.t).toBe('not_host');
    }
    expect(JSON.stringify(a.last('lobby'))).toBe(before);
  });

  it('lets players edit their own seat and the host edit bot seats', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    const [sa, , bot] = a.last('lobby')!.lobby.seats;
    room.handle(b, { t: 'setSeat', seatId: sa.id, name: 'Hacker' });
    expect(b.lastError()).toBe('bad_seat');
    room.handle(b, { t: 'setSeat', seatId: bot.id, side: 'B' });
    expect(b.lastError()).toBe('bad_seat');
    room.handle(a, { t: 'setSeat', seatId: bot.id, side: 'B', academyId: 'runeforge' });
    room.handle(b, { t: 'setSeat', name: 'Bobby', side: 'B' });
    room.handle(a, { t: 'setBotLevel', seatId: bot.id, level: 'hard' });
    const seats = a.last('lobby')!.lobby.seats;
    expect(seats[1]).toMatchObject({ name: 'Bobby', side: 'B' });
    expect(seats[2]).toMatchObject({ side: 'B', academyId: 'runeforge', botLevel: 'hard', kind: 'bot', name: 'Bot 1' });
  });

  it('validates academy picks', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'setSeat', academyId: 'nope' });
    expect(a.lastError()).toBe('unknown_academy');
    room.handle(a, { t: 'setSeat', academyId: 'pyromancy' });
    room.handle(b, { t: 'setSeat', academyId: 'pyromancy' });
    expect(b.lastError()).toBe('academy_taken');
    room.handle(a, { t: 'setSeat', academyId: null });
    room.handle(b, { t: 'setSeat', academyId: 'pyromancy' });
    expect(b.last('lobby')!.lobby.seats.map((s) => s.academyId)).toEqual([null, 'pyromancy']);
  });

  it('validates settings ranges', () => {
    const { room, conns } = lobbyWith(['Ana']);
    const [a] = conns;
    room.handle(a, { t: 'settings', settings: { graceMs: 5000 } });
    expect(a.lastError()).toBe('bad_settings');
    room.handle(a, { t: 'settings', settings: { turnTimerMs: 1_000_000 } });
    expect(a.lastError()).toBe('bad_settings');
    room.handle(a, { t: 'settings', settings: { turnTimerMs: 30_000, graceMs: 20_000 } });
    expect(a.last('lobby')!.lobby.settings).toEqual({ graceMs: 20_000, turnTimerMs: 30_000 });
    room.handle(a, { t: 'settings', settings: { turnTimerMs: null } });
    expect(a.last('lobby')!.lobby.settings.turnTimerMs).toBeNull();
  });

  it('caps the room at 7 seats', () => {
    const { room, conns } = lobbyWith(['A', 'B', 'C', 'D', 'E', 'F']);
    room.handle(conns[0], { t: 'addBot', level: 'normal' });
    room.handle(conns[0], { t: 'addBot', level: 'normal' });
    expect(conns[0].lastError()).toBe('room_full');
    const late = new FakeConn();
    room.join(late, 'Late');
    expect(late.lastError()).toBe('room_full');
    expect(conns[0].last('lobby')!.lobby.seats).toHaveLength(7);
  });

  it('needs 2+ seats to start; 2 players get the Rival Archmage between them', () => {
    const { room, conns } = lobbyWith(['Ana']);
    const [a] = conns;
    room.handle(a, { t: 'start' });
    expect(a.lastError()).toBe('seat_count');
    const b = new FakeConn();
    room.join(b, 'Bob');
    room.handle(a, { t: 'start' });
    const ga = a.last('game')!;
    const gb = b.last('game')!;
    expect(ga.view.players).toHaveLength(3);
    expect(ga.view.players[1].config.kind).toBe('archmage');
    expect(ga.view.me).toBe(0);
    expect(gb.view.me).toBe(2);
    expect(ga.legal.length).toBeGreaterThan(0);
    expect(room.phase).toBe('game');
    const late = new FakeConn();
    room.join(late, 'Late');
    expect(late.lastError()).toBe('wrong_phase');
  });
});
