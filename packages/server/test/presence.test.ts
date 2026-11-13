import { describe, expect, it } from 'vitest';
import { FakeConn, lobbyWith, playToEnd } from './fakes';

/** 2 humans + 1 bot, started. Ana is engine seat 0, Bob seat 1, bot seat 2. */
function started(settings: { graceMs?: number; turnTimerMs?: number | null } = {}) {
  const setup = lobbyWith(['Ana', 'Bob']);
  const [a] = setup.conns;
  setup.room.handle(a, { t: 'addBot', level: 'normal' });
  if (Object.keys(settings).length) setup.room.handle(a, { t: 'settings', settings });
  setup.room.handle(a, { t: 'start' });
  return setup;
}

describe('rejoin', () => {
  it('gives the seat back with the same hand', () => {
    const { room, conns } = started();
    const [, b] = conns;
    const token = b.last('joined')!.token;
    const before = b.last('game')!;
    room.disconnect(b);
    const b2 = new FakeConn();
    room.rejoin(b2, token);
    expect(b2.last('joined')!.seatId).toBe(b.last('joined')!.seatId);
    const g = b2.last('game')!;
    expect(g.view.me).toBe(before.view.me);
    expect(g.view.players[g.view.me].hand).toEqual(before.view.players[before.view.me].hand);
    const bad = new FakeConn();
    room.rejoin(bad, 'f'.repeat(32));
    expect(bad.lastError()).toBe('bad_token');
  });

  it('replaces a stale connection', () => {
    const { room, conns } = started();
    const [, b] = conns;
    const b2 = new FakeConn();
    room.rejoin(b2, b.last('joined')!.token);
    expect(b.closedWith).toBe('replaced');
    expect(room.hasMember(b)).toBe(false);
    expect(room.hasMember(b2)).toBe(true);
    room.handle(b, { t: 'act', action: b.last('game')!.legal[0] });
    expect(b.lastError()).toBe('not_in_room');
    room.handle(b2, { t: 'act', action: b2.last('game')!.legal[0] });
    expect(b2.lastError()).toBeUndefined();
    // the stale socket closing late must not mark the seat as disconnected
    room.disconnect(b);
    expect(b2.last('game')!.seats[1].connected).toBe(true);
  });
});

describe('bot takeover', () => {
  it('starts after the grace period and ends when the player returns', () => {
    const { room, clock, conns } = started({ graceMs: 20_000 });
    const [a, b] = conns;
    room.disconnect(b);
    expect(a.last('game')!.seats[1]).toMatchObject({ connected: false, botControlled: false });
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    clock.advance(19_999);
    expect(a.last('game')!.view.turn).toBe(1);
    clock.advance(1);
    expect(a.last('game')!.seats[1].botControlled).toBe(true);
    expect(a.last('game')!.view.turn).toBe(2);
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.view.turn).toBe(3);

    const b2 = new FakeConn();
    room.rejoin(b2, b.last('joined')!.token);
    expect(b2.last('game')!.seats[1]).toMatchObject({ connected: true, botControlled: false });
    // the bot already picked for turn 3, so that turn resolves when Ana acts
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.view.turn).toBe(4);
    // from turn 4 on, the turn waits for Bob again
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.view.turn).toBe(4);
    room.handle(b2, { t: 'act', action: b2.last('game')!.legal[0] });
    expect(a.last('game')!.view.turn).toBe(5);
  });

  it('keeps the bot pick when the player returns mid-turn', () => {
    const { room, clock, conns } = started({ graceMs: 20_000 });
    const [a, b] = conns;
    room.disconnect(b);
    clock.advance(20_000); // the bot submits for Bob; the turn waits for Ana
    expect(a.last('game')!.view.players[1].hasSubmitted).toBe(true);
    const b2 = new FakeConn();
    room.rejoin(b2, b.last('joined')!.token);
    expect(b2.last('game')!.legal).toEqual([]);
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(b2.last('game')!.view.turn).toBe(2);
    expect(b2.last('game')!.legal.length).toBeGreaterThan(0);
  });

  it('finishes the game if everyone is away', () => {
    const { room, clock, conns } = started({ graceMs: 10_000 });
    conns.forEach((c) => room.disconnect(c));
    clock.advance(10_000);
    expect(room.state!.phase).toBe('ended');
  });

  it('takes over at once when a player leaves mid-game, and they may rejoin', () => {
    const { room, conns } = started();
    const [a, b] = conns;
    const token = b.last('joined')!.token;
    room.handle(b, { t: 'leave' });
    expect(b.closedWith).toBe('left');
    expect(a.last('game')!.seats[1].botControlled).toBe(true);
    const b2 = new FakeConn();
    room.rejoin(b2, token);
    expect(b2.last('game')!.seats[1].botControlled).toBe(false);
    playToEnd(room, [a, b2]);
    expect(a.last('game')!.result).toBeDefined();
  });

  it('ends the game when the last real player leaves and only bots remain', () => {
    const { room, conns } = started();
    const [a, b] = conns;
    room.handle(a, { t: 'leave' });
    expect(room.closed).toBe(false);
    expect(b.last('game')!.seats[0].botControlled).toBe(true);
    room.handle(b, { t: 'leave' });
    expect(room.closed).toBe(true);
  });

  it('a solo game against bots ends when the player leaves', () => {
    const { room, conns } = lobbyWith(['Ana']);
    const [a] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.handle(a, { t: 'start' });
    room.handle(a, { t: 'leave' });
    expect(a.closedWith).toBe('left');
    expect(room.closed).toBe(true);
  });
});

describe('turn timer', () => {
  it('auto-picks for everyone who has not acted when time runs out', () => {
    const { room, clock, conns } = started({ turnTimerMs: 30_000 });
    const [a] = conns;
    const g = a.last('game')!;
    expect(g.deadline).toBe(clock.now() + 30_000);
    clock.advance(29_999);
    expect(a.last('game')!.view.turn).toBe(1);
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.deadline).toBe(g.deadline); // acting does not reset the clock
    clock.advance(1);
    expect(a.last('game')!.view.turn).toBe(2);
    expect(a.last('game')!.deadline).toBe(clock.now() + 30_000);
  });

  it('is off by default', () => {
    const { conns } = started();
    expect(conns[0].last('game')!.deadline).toBeNull();
  });
});

describe('lobby presence', () => {
  it('removes a player who leaves', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(b, { t: 'leave' });
    expect(b.closedWith).toBe('left');
    expect(a.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana']);
  });

  it('passes host on when the host stays away, and closes when no humans remain', () => {
    const { room, clock, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.disconnect(a);
    expect(b.last('lobby')!.lobby.seats[0].connected).toBe(false);
    clock.advance(60_000);
    const lobby = b.last('lobby')!.lobby;
    expect(lobby.seats.map((s) => s.name)).toEqual(['Bob', 'Bot 1']);
    expect(lobby.hostId).toBe(b.last('joined')!.seatId);
    room.handle(b, { t: 'leave' });
    expect(room.closed).toBe(true);
  });

  it('lets the host remove a human seat but not their own', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'removeSeat', seatId: a.last('joined')!.seatId });
    expect(a.lastError()).toBe('bad_seat');
    room.handle(a, { t: 'removeSeat', seatId: b.last('joined')!.seatId });
    expect(b.closedWith).toBe('removed');
    expect(a.last('lobby')!.lobby.seats).toHaveLength(1);
  });
});

describe('rematch', () => {
  it('returns everyone to the lobby after the game, host only', () => {
    const { room, conns } = started();
    const [a, b] = conns;
    room.handle(a, { t: 'rematch' });
    expect(a.lastError()).toBe('wrong_phase');
    playToEnd(room, conns);
    room.handle(b, { t: 'rematch' });
    expect(b.lastError()).toBe('not_host');
    room.handle(a, { t: 'rematch' });
    expect(room.phase).toBe('lobby');
    expect(b.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana', 'Bob', 'Bot 1']);
    room.handle(a, { t: 'start' });
    expect(a.last('game')!.view.turn).toBe(1);
  });

  it('lets another player call the rematch when the host is gone', () => {
    const { room, clock, conns } = started();
    const [a, b] = conns;
    room.disconnect(a);
    clock.advance(60_000);
    playToEnd(room, [b]);
    room.handle(b, { t: 'rematch' });
    expect(b.lastError()).toBeUndefined();
    const lobby = b.last('lobby')!.lobby;
    expect(lobby.seats.map((s) => s.name)).toEqual(['Bob', 'Bot 1']);
    expect(lobby.hostId).toBe(b.last('joined')!.seatId);
  });
});
