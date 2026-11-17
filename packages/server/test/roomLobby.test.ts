import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { Room } from '../src/room';
import { FakeConn, playToEnd } from './fakes';

/** A host room created with settings, as the Create Room screen does. */
function roomWith(names: string[], config: Partial<RoomConfig> = {}) {
  const clock = new ManualClock(1_000_000);
  const room = new Room('OWLS-30', { clientUrl: 'http://client', seed: () => 7, shuffle: (xs) => xs }, clock, {
    kind: 'room',
    config: { ...DEFAULT_ROOM_CONFIG, ...config },
  });
  const conns = names.map((n) => new FakeConn(n));
  conns.forEach((c, i) => room.join(c, names[i]));
  return { room, conns };
}

const errors = (c: FakeConn) => c.sent.filter((m) => m.t === 'error').length;

describe('room lobby: seats and academies', () => {
  it('fills empty seats with bots at the room bot level when the host starts', () => {
    const { room, conns } = roomWith(['Ana', 'Bob'], { seats: 5, botLevel: 'hard' });
    const [a] = conns;
    expect(a.last('lobby')!.lobby.seats).toHaveLength(2);
    room.handle(a, { t: 'start' });
    expect(a.lastError()).toBeUndefined();
    const players = a.last('game')!.view.players;
    expect(players).toHaveLength(5);
    expect(players.filter((p) => p.config.kind === 'bot').map((p) => p.config.botLevel)).toEqual(['hard', 'hard', 'hard']);
  });

  it('starts with one human: bots fill the rest (2 seats: the Rival Archmage joins too)', () => {
    const { room, conns } = roomWith(['Ana'], { seats: 2 });
    room.handle(conns[0], { t: 'start' });
    expect(conns[0].lastError()).toBeUndefined();
    expect(conns[0].last('game')!.view.players.map((p) => p.config.kind)).toEqual(['human', 'archmage', 'bot']);
  });

  it('keeps bots the host added and only fills what is still free', () => {
    const { room, conns } = roomWith(['Ana'], { seats: 4 });
    room.handle(conns[0], { t: 'addBot', level: 'easy' });
    expect(conns[0].last('lobby')!.lobby.seats).toHaveLength(2);
    room.handle(conns[0], { t: 'start' });
    expect(conns[0].last('game')!.view.players).toHaveLength(4);
  });

  it('frees the filled seats again when the table goes back to the lobby', () => {
    const { room, conns } = roomWith(['Ana', 'Bob'], { seats: 4 });
    room.handle(conns[0], { t: 'start' });
    playToEnd(room, conns);
    room.handle(conns[0], { t: 'rematch' });
    const lobby = conns[0].last('lobby')!.lobby;
    expect(lobby.seats.map((s) => s.kind)).toEqual(['human', 'human']);
    expect(lobby.config!.seats).toBe(4);
  });

  it('an academy picked by one player is taken for everyone else; Random stays open and draws avoid it', () => {
    const { room, conns } = roomWith(['Ana', 'Bob', 'Cy'], { seats: 3 });
    const [a, b, c] = conns;
    room.handle(a, { t: 'setSeat', academyId: 'pyromancy' });
    room.handle(b, { t: 'setSeat', academyId: 'pyromancy' });
    expect(b.lastError()).toBe('academy_taken');
    room.handle(c, { t: 'setSeat', academyId: 'pyromancy' });
    expect(c.lastError()).toBe('academy_taken');
    const before = errors(b);
    room.handle(b, { t: 'setSeat', academyId: null });
    expect(errors(b)).toBe(before);
    room.handle(a, { t: 'start' });
    const academies = a.last('game')!.view.players.map((p) => p.academyId);
    expect(academies[0]).toBe('pyromancy');
    expect(academies.filter((x) => x === 'pyromancy')).toHaveLength(1);
  });

  it('Casual/Ranked tables draw academies: no picking there', () => {
    const clock = new ManualClock(1_000_000);
    const room = new Room('Q-1', { clientUrl: 'http://client', seed: () => 7, shuffle: (xs) => xs }, clock, { kind: 'casual' });
    const a = new FakeConn('a');
    room.join(a, 'Ana');
    room.handle(a, { t: 'setSeat', academyId: 'pyromancy' });
    expect(a.lastError()).toBe('wrong_phase');
  });
});
