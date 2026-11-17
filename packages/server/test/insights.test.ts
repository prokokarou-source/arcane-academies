import { describe, expect, it } from 'vitest';
import { computeNumbers, DAY_MS, MemoryInsights, type AnalyticsEvent } from '../src/insights';
import { open, seal, boxKey } from '../src/secretBox';
import type { GameEvent } from '../src/room';
import { lobbyWith, playToEnd } from './fakes';

const LIVE = { online: 1, connections: 2, gamesInProgress: 0 };
const D0 = 20_000 * DAY_MS; // a UTC midnight
const ev = (kind: AnalyticsEvent['kind'], at: number, device: string | null, extra: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({
  kind,
  at,
  device,
  userId: null,
  ...extra,
});

describe('usage numbers', () => {
  it('counts visitors, accounts, games per mode and the funnel', () => {
    const now = D0 + 12 * 3600_000;
    const events = [
      ev('open', D0 + 1000, 'devA'),
      ev('open', D0 + 2000, 'devB'),
      ev('open', D0 - 3 * DAY_MS, 'devC'),
      ev('signup', D0 + 3000, 'devA', { userId: '1' }),
      ev('active', D0 + 3000, 'devA', { userId: '1' }),
      // devA: two bots games, one finished; devB starts a ranked game with devA.
      ev('game_start', D0 + 4000, 'devA', { mode: 'bots', game: 'g1' }),
      ev('term2', D0 + 5000, 'devA', { mode: 'bots', game: 'g1' }),
      ev('game_finish', D0 + 6000, 'devA', { mode: 'bots', game: 'g1' }),
      ev('game_start', D0 + 7000, 'devA', { mode: 'ranked', game: 'g2' }),
      ev('game_start', D0 + 7000, 'devB', { mode: 'ranked', game: 'g2' }),
      ev('game_start', D0 - 2 * DAY_MS, 'devC', { mode: 'casual', game: 'g0' }),
    ];
    const n = computeNumbers(events, new Map(), now, LIVE);
    expect(n.today.visitors).toBe(2);
    expect(n.week.visitors).toBe(3);
    expect(n.today.newAccounts).toBe(1);
    expect(n.today.activePlayers).toBe(1);
    expect(n.today.games.bots).toEqual({ started: 1, finished: 1 });
    // One ranked game with two players is one game.
    expect(n.today.games.ranked).toEqual({ started: 1, finished: 0 });
    expect(n.today.games.casual).toEqual({ started: 0, finished: 0 });
    expect(n.week.games.casual).toEqual({ started: 1, finished: 0 });
    expect(n.today.funnel).toEqual({ opened: 2, started: 2, term2: 1, finished: 1, secondGame: 1 });
    expect(n.live).toEqual(LIVE);
  });

  it('measures next-day and next-week retention of new devices only once they are old enough', () => {
    const now = D0 + 10 * DAY_MS + 3600_000;
    const fresh = new Map([
      ['back', D0],
      ['gone', D0 + 1000],
      ['late', D0 + 9 * DAY_MS], // first seen yesterday: too new for next-week
      ['today', D0 + 10 * DAY_MS],
    ]);
    const events = [
      ev('open', D0, 'back'),
      ev('open', D0 + DAY_MS + 5, 'back'),
      ev('open', D0 + 1000, 'gone'),
      ev('open', D0 + 9 * DAY_MS, 'late'),
      ev('open', D0 + 10 * DAY_MS, 'late'),
      ev('open', D0 + 10 * DAY_MS, 'today'),
    ];
    const n = computeNumbers(events, fresh, now, LIVE);
    expect(n.month.nextDay).toEqual({ cohort: 3, returned: 2 });
    expect(n.month.nextWeek).toEqual({ cohort: 2, returned: 1 });
  });

  it('keeps "open" once per device per day in the memory store', async () => {
    const s = new MemoryInsights();
    await s.addEvent(ev('open', D0 + 1, 'devA'));
    await s.addEvent(ev('open', D0 + 2, 'devA'));
    await s.addEvent(ev('open', D0 + DAY_MS, 'devA'));
    expect(await s.events(0)).toHaveLength(2);
    expect([...(await s.newDevices(0))]).toEqual([['devA', D0 + 1]]);
  });
});

describe('secret box', () => {
  it('round-trips with the right key only', () => {
    const k = boxKey('a-long-random-admin-key')!;
    const box = seal(k, Buffer.from('secret'));
    expect(open(k, box)?.toString()).toBe('secret');
    expect(open(boxKey('another-long-admin-key')!, box)).toBeNull();
    const [v, iv, tag, data] = box.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(open(k, [v, iv, tag, flipped.toString('base64url')].join('.'))).toBeNull();
    expect(boxKey('short')).toBeNull();
    expect(boxKey(undefined)).toBeNull();
  });
});

describe('room game events', () => {
  it('reports start, Term 2 and finish with the people only (never bots)', () => {
    const events: GameEvent[] = [];
    const { room, conns } = lobbyWith(['Ana', 'Bob'], { onGameEvent: (e) => events.push(e) });
    room.handle(conns[0], { t: 'addBot', level: 'normal' });
    room.handle(conns[0], { t: 'start' });
    playToEnd(room, conns);
    expect(events.map((e) => e.kind)).toEqual(['game_start', 'term2', 'game_finish']);
    for (const e of events) {
      expect(e.mode).toBe('room');
      expect(e.players).toHaveLength(2);
      expect(e.game).toBe(events[0].game);
    }
  });
});
