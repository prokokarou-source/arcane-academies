import { describe, expect, it } from 'vitest';
import type { Avatar } from '@arcane/protocol';
import type { Conn } from '../src/room';
import { FakeConn, lobbyWith, makeRoom, playToEnd } from './fakes';

/** Ana (host), Bob and a Hard bot played a game to the end. */
function ended() {
  const setup = lobbyWith(['Ana', 'Bob']);
  const [a, b] = setup.conns;
  setup.room.handle(a, { t: 'addBot', level: 'hard' });
  setup.room.handle(a, { t: 'settings', settings: { turnTimerMs: 60_000 } });
  setup.room.handle(b, { t: 'setSeat', academyId: 'pyromancy' });
  setup.room.handle(a, { t: 'start' });
  playToEnd(setup.room, setup.conns);
  return { ...setup, a, b };
}

/** This conn's latest game message is a brand-new game. */
const fresh = (c: FakeConn) => {
  const g = c.last('game')!;
  return !g.result && g.view.term === 1 && g.view.turn === 1;
};

describe('play again', () => {
  it('is refused before the game ends', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    room.handle(conns[0], { t: 'start' });
    room.handle(conns[1], { t: 'playAgain', ready: true });
    expect(conns[1].lastError()).toBe('wrong_phase');
    room.handle(conns[0], { t: 'playAgainNow' });
    expect(conns[0].lastError()).toBe('wrong_phase');
  });

  it('shows who is ready, then starts the next game once everyone is', () => {
    const { room, a, b } = ended();
    const seats = () => a.last('game')!.seats;
    expect(seats().map((s) => s.ready)).toEqual([false, false, undefined]);
    expect(seats()[0].host).toBe(true);
    room.handle(b, { t: 'playAgain', ready: true });
    expect(b.last('game')!.seats.map((s) => s.ready)).toEqual([false, true, undefined]);
    room.handle(b, { t: 'playAgain', ready: false });
    room.handle(a, { t: 'playAgain', ready: true });
    expect(a.last('game')!.result).toBeDefined();
    room.handle(b, { t: 'playAgain', ready: true });
    expect(fresh(a) && fresh(b)).toBe(true);
    const g = b.last('game')!;
    // Same seats and bots; Bob's chosen academy kept; settings kept; ready flags gone.
    expect(g.seats.map((s) => s.name)).toEqual(['Ana', 'Bob', 'Bot 1']);
    expect(g.view.players[1].academyId).toBe('pyromancy');
    expect(g.deadline).not.toBeNull();
    expect(g.seats.every((s) => s.ready === undefined)).toBe(true);
  });

  it('lets the host start now; players who are still here come along', () => {
    const { room, a, b } = ended();
    room.handle(b, { t: 'playAgainNow' });
    expect(b.lastError()).toBe('not_host');
    room.handle(a, { t: 'playAgainNow' });
    expect(fresh(a) && fresh(b)).toBe(true);
  });

  it('drops players who left and starts when the rest are ready', () => {
    const { room, a, b } = ended();
    room.handle(a, { t: 'playAgain', ready: true });
    room.handle(b, { t: 'leave' });
    expect(b.closedWith).toBe('left');
    expect(fresh(a)).toBe(true);
    expect(a.last('game')!.seats.filter((s) => s.kind !== 'archmage').map((s) => s.name)).toEqual(['Ana', 'Bot 1']);
  });

  it('a disconnected player does not block the others, and is dropped', () => {
    const { room, a, b } = ended();
    room.handle(a, { t: 'playAgain', ready: true });
    room.disconnect(b);
    expect(fresh(a)).toBe(true);
    const again = new FakeConn();
    room.rejoin(again, b.last('joined')!.token);
    expect(again.lastError()).toBe('bad_token');
  });

  it('a host who is gone cannot block "start now"', () => {
    const { room, a, b } = ended();
    room.disconnect(a);
    room.handle(b, { t: 'playAgainNow' });
    expect(b.lastError()).toBeUndefined();
    expect(fresh(b)).toBe(true);
    expect(b.last('game')!.seats.find((s) => s.name === 'Bob')!.host).toBe(true);
  });

  it('goes back to the lobby when too few seats are left', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'start' });
    playToEnd(room, conns);
    room.handle(b, { t: 'leave' });
    room.handle(a, { t: 'playAgainNow' });
    expect(room.phase).toBe('lobby');
    expect(a.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana']);
  });

  it('back to lobby (rematch) clears the ready flags', () => {
    const { room, a, b } = ended();
    room.handle(b, { t: 'playAgain', ready: true });
    room.handle(a, { t: 'rematch' });
    room.handle(a, { t: 'start' });
    playToEnd(room, [a, b]);
    expect(a.last('game')!.seats.map((s) => s.ready)).toEqual([false, false, undefined]);
  });

  it('works in quick-match rooms', () => {
    const { room, clock, conns } = lobbyWith(['Ana', 'Bob']);
    room.startCountdown(10_000, 3);
    clock.advance(10_000);
    playToEnd(room, conns);
    conns.forEach((c) => room.handle(c, { t: 'playAgain', ready: true }));
    expect(conns.every(fresh)).toBe(true);
    expect(conns[0].last('game')!.seats).toHaveLength(3);
  });
});

describe('avatars in rooms', () => {
  it('seats carry the account avatar in the lobby and the game; guests and bots none', () => {
    const avatars = new Map<Conn, Avatar>();
    const { room } = makeRoom({ avatarOf: (c) => avatars.get(c) ?? null });
    const a = new FakeConn('Ana');
    const b = new FakeConn('Bob');
    avatars.set(a, { icon: 'owl', color: 'teal' });
    room.join(a, 'Ana');
    room.join(b, 'Bob');
    room.handle(a, { t: 'addBot', level: 'easy' });
    expect(b.last('lobby')!.lobby.seats.map((s) => s.avatar)).toEqual([{ icon: 'owl', color: 'teal' }, undefined, undefined]);
    room.handle(a, { t: 'start' });
    expect(b.last('game')!.seats[0].avatar).toEqual({ icon: 'owl', color: 'teal' });
    avatars.set(a, { icon: 'comet', color: 'rose' });
    room.refreshAvatar(a);
    expect(b.last('game')!.seats[0].avatar).toEqual({ icon: 'comet', color: 'rose' });
  });
});
