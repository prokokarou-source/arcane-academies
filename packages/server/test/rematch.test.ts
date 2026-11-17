import { describe, expect, it } from 'vitest';
import type { Avatar } from '@arcane/protocol';
import { PLAY_AGAIN_MS } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { Room, type Conn } from '../src/room';
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

  it('Main menu after the game: that player goes, everyone else goes back to the room lobby', () => {
    const { room, a, b } = ended();
    room.handle(a, { t: 'playAgain', ready: true });
    room.handle(b, { t: 'leave' });
    expect(b.closedWith).toBe('left');
    expect(room.phase).toBe('lobby');
    expect(a.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana', 'Bot 1']);
  });

  it('the host passes to the next player when the host leaves', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob', 'Cy']);
    const [a, b, c] = conns;
    room.handle(a, { t: 'start' });
    playToEnd(room, conns);
    room.handle(a, { t: 'leave' });
    const lobby = c.last('lobby')!.lobby;
    expect(lobby.hostId).toBe(b.last('joined')!.seatId);
    expect(lobby.seats.map((s) => s.name)).toEqual(['Bob', 'Cy']);
  });

  it('after 20 s without everyone ready, the table goes back to the lobby', () => {
    const { room, clock, a, b } = ended();
    const end = a.last('game')!;
    expect(end.lobbyAt).toBe(clock.now() + PLAY_AGAIN_MS);
    room.handle(a, { t: 'playAgain', ready: true });
    clock.advance(PLAY_AGAIN_MS - 1);
    expect(room.phase).toBe('game');
    clock.advance(1);
    expect(room.phase).toBe('lobby');
    expect(b.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana', 'Bob', 'Bot 1']);
  });

  it('a game started in time cancels the 20 s timer', () => {
    const { room, clock, a, b } = ended();
    room.handle(a, { t: 'playAgain', ready: true });
    room.handle(b, { t: 'playAgain', ready: true });
    expect(fresh(a)).toBe(true);
    expect(a.last('game')!.lobbyAt).toBeUndefined();
    clock.advance(PLAY_AGAIN_MS);
    expect(room.phase).toBe('game');
    expect(fresh(a)).toBe(true);
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

  it('queue tables cannot be replayed in place (Play again queues again) and get no lobby timer', () => {
    for (const kind of ['casual', 'ranked'] as const) {
      const clock = new ManualClock(1_000_000);
      const room = new Room('Q-1', { clientUrl: 'http://c', seed: () => 7 }, clock, { kind, queue: '1v1' });
      const conns = [new FakeConn('a'), new FakeConn('b')];
      conns.forEach((c, i) => room.join(c, `P${i}`));
      room.startCountdown(1);
      clock.advance(1);
      playToEnd(room, conns);
      expect(conns[0].last('game')).toMatchObject({ kind, queue: '1v1' });
      expect(conns[0].last('game')!.lobbyAt).toBeUndefined();
      for (const t of ['rematch', 'playAgainNow'] as const) {
        room.handle(conns[0], { t });
        expect(conns[0].lastError()).toBe('wrong_phase');
      }
      clock.advance(PLAY_AGAIN_MS);
      expect(room.state!.phase).toBe('ended');
    }
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
