import { describe, expect, it } from 'vitest';
import { shuffle } from '../src/room';
import { lobbyWith, playToEnd } from './fakes';

const order = (c: { last: (t: 'game') => { seats: { name: string; kind: string }[] } | undefined }) =>
  c.last('game')!.seats.filter((s) => s.kind !== 'archmage').map((s) => s.name);

describe('random seating in rooms', () => {
  it('seats the table in the shuffled order, bots with the humans, every game', () => {
    let calls = 0;
    // Reverse on every start: Play again gets a new order too.
    const { room, conns } = lobbyWith(['Ana', 'Bob'], {
      shuffle: (xs) => {
        calls++;
        return [...xs].reverse();
      },
    });
    const [a, b] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.handle(a, { t: 'start' });
    expect(order(a)).toEqual(['Bot 1', 'Bob', 'Ana']);
    // Each player still sees their own seat.
    expect(a.last('game')!.seats[a.last('game')!.view.me].name).toBe('Ana');
    expect(b.last('game')!.seats[b.last('game')!.view.me].name).toBe('Bob');
    playToEnd(room, conns);
    room.handle(a, { t: 'playAgain', ready: true });
    room.handle(b, { t: 'playAgain', ready: true });
    expect(calls).toBe(2);
    expect(order(a)).toEqual(['Ana', 'Bob', 'Bot 1']);
  });

  it('2 seats: the Rival Archmage still sits between the two players', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob'], { shuffle: (xs) => [...xs].reverse() });
    room.handle(conns[0], { t: 'start' });
    const g = conns[0].last('game')!;
    expect(g.seats.map((s) => s.kind)).toEqual(['human', 'archmage', 'human']);
    expect(g.seats.map((s) => s.name)).toEqual(['Bob', expect.any(String), 'Ana']);
    expect(g.seats[g.view.me].name).toBe('Ana');
  });

  it('the default shuffle keeps everyone and reaches every order', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const out = shuffle([1, 2, 3]);
      expect([...out].sort()).toEqual([1, 2, 3]);
      seen.add(out.join(''));
    }
    expect(seen.size).toBe(6);
  });
});
