import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock';
import { placesOf, Room, type Conn } from '../src/room';
import type { GameRecord } from '../src/store';
import { FakeConn, playToEnd } from './fakes';
import { ratingDeltas } from '../src/rating';

describe('finishing places', () => {
  it('ranked: equal totals share a place, whatever the coins', () => {
    const p = placesOf(
      [
        { seat: 0, total: 50, coins: 1 },
        { seat: 1, total: 50, coins: 9 },
        { seat: 2, total: 40, coins: 3 },
      ],
      true,
    );
    expect([p.get(0), p.get(1), p.get(2)]).toEqual([1, 1, 3]);
    // ...which rates as a draw between the two.
    const d = ratingDeltas([
      { id: 'a', rating: 1000, place: 1 },
      { id: 'b', rating: 1000, place: 1 },
    ]);
    expect(d.get('a')).toBe(0);
  });

  it('ranked: everyone who quit shares last place, below all who stayed', () => {
    const p = placesOf(
      [
        { seat: 0, total: 70, coins: 0, quit: true },
        { seat: 1, total: 30, coins: 0 },
        { seat: 2, total: 60, coins: 0, quit: true },
        { seat: 3, total: 45, coins: 0 },
      ],
      true,
    );
    expect([p.get(0), p.get(1), p.get(2), p.get(3)]).toEqual([3, 2, 3, 1]);
  });

  it('other games keep the coin tiebreak', () => {
    const p = placesOf(
      [
        { seat: 0, total: 50, coins: 1 },
        { seat: 1, total: 50, coins: 9 },
        { seat: 2, total: 50, coins: 9 },
      ],
      false,
    );
    expect([p.get(0), p.get(1), p.get(2)]).toEqual([3, 1, 1]);
  });
});

describe('ranked leaver', () => {
  it('is recorded last and not as a winner even when the bot playing the seat wins', () => {
    const clock = new ManualClock(1_000_000);
    const results: GameRecord[][] = [];
    const accounts = new Map<Conn, string>();
    const room = new Room(
      'RANK-1',
      { clientUrl: 'http://c', seed: () => 7, accountOf: (c) => accounts.get(c) ?? null, onResults: (r) => results.push(r) },
      clock,
      { kind: 'ranked', queue: '1v1' },
    );
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    accounts.set(a, 'ua');
    accounts.set(b, 'ub');
    room.join(a, 'Ana');
    room.join(b, 'Bob');
    room.startCountdown(1);
    clock.advance(1);
    room.handle(a, { t: 'leave' });
    // Bob plays the last legal move every time; the bot on Ana's seat plays properly.
    playToEnd(room, [b], (legal) => legal[legal.length - 1]);
    const [rec] = results;
    const ana = rec.find((r) => r.userId === 'ua')!;
    const bob = rec.find((r) => r.userId === 'ub')!;
    // The bot on her seat finished ahead...
    expect(ana.score).toBeGreaterThan(bob.score);
    // ...yet she is last for rating.
    expect(ana.place).toBe(2);
    expect(ana.won).toBe(false);
    expect(bob.place).toBe(1);
  });
});
