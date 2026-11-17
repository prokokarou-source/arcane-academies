import { describe, expect, it } from 'vitest';
import { USERNAME_RE, type Queue, type QueueKind, type SocialMessage } from '@arcane/protocol';
import { AI_POOL_SIZE, AI_PROFILES } from '../src/aiProfiles';
import { ManualClock } from '../src/clock';
import { RoomManager, type ManagerOptions } from '../src/manager';
import { aiThinkMs, type Conn } from '../src/room';
import { Social } from '../src/social';
import { MemoryStore, type GameRecord } from '../src/store';
import { FakeConn } from './fakes';

const SEC = 1000;
const accountOf = (c: Conn) => ((c as FakeConn).label.startsWith('guest') ? null : (c as FakeConn).label);

function setup(opts: Partial<ManagerOptions> = {}) {
  const clock = new ManualClock(1_000_000);
  const records: GameRecord[][] = [];
  const mgr = new RoomManager(
    // random() = 0: AI fill after exactly 5 s, the smallest table, the quickest thinks.
    { clientUrl: 'http://client', seed: () => 7, quickStartMs: 10 * SEC, random: () => 0, accountOf, onResults: (r) => records.push(r), ...opts },
    clock,
  );
  const queue = (name: string, queue: Queue = '1v1', kind: QueueKind = 'casual') => {
    const c = new FakeConn(name);
    mgr.onMessage(c, { t: 'queueJoin', kind, queue, name });
    return c;
  };
  return { clock, mgr, queue, records };
}

/** Let the people act whenever they can and time pass otherwise, until the game ends. */
function playOut(mgr: RoomManager, clock: ManualClock, people: FakeConn[]) {
  for (let i = 0; i < 20_000; i++) {
    if (people.some((c) => c.last('game')?.result)) return;
    const c = people.find((x) => (x.last('game')?.legal.length ?? 0) > 0);
    if (c) mgr.onMessage(c, { t: 'act', action: c.last('game')!.legal[0] });
    else clock.advance(SEC);
  }
  throw new Error('game did not end');
}

describe('AI profile pool', () => {
  it('has ~200 distinct, valid, player-like handles with avatars and countries, mostly European', () => {
    expect(AI_PROFILES).toHaveLength(AI_POOL_SIZE);
    const names = AI_PROFILES.map((p) => p.username.toLowerCase());
    expect(new Set(names).size).toBe(AI_POOL_SIZE);
    for (const p of AI_PROFILES) {
      expect(p.username).toMatch(USERNAME_RE);
      expect(p.username).not.toMatch(/^bot/i);
      expect(p.avatar.icon && p.avatar.color).toBeTruthy();
      expect(p.country).toMatch(/^[A-Z]{2}$/);
    }
    const gr = AI_PROFILES.filter((p) => p.country === 'GR').length;
    for (const c of new Set(AI_PROFILES.map((p) => p.country))) {
      expect(AI_PROFILES.filter((p) => p.country === c).length).toBeLessThanOrEqual(gr);
    }
  });
});

describe('AI think time', () => {
  it('is 2-15 s: quick on obvious picks, slow on close ones', () => {
    for (const m of [0, 0.5, 1, 3, 10, 99]) {
      for (const r of [0, 0.5, 0.999]) {
        const ms = aiThinkMs(m, r, r);
        expect(ms).toBeGreaterThanOrEqual(2_000);
        expect(ms).toBeLessThanOrEqual(15_000);
      }
    }
    expect(aiThinkMs(99, 0.5, 0.5)).toBeLessThan(3_500);
    expect(aiThinkMs(0, 0.5, 0.5)).toBeGreaterThan(9_000);
  });
});

describe('AI opponents in Casual and Ranked', () => {
  it('fill the empty seat after the search time; they look like players', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana');
    clock.advance(5 * SEC - 1);
    expect(a.last('joined')).toBeUndefined();
    clock.advance(1);
    expect(mgr.searching()).toBe(0);
    const seats = a.last('lobby')!.lobby.seats;
    expect(seats).toHaveLength(2);
    const ai = seats[1];
    expect(ai).toMatchObject({ kind: 'human', connected: true });
    expect(ai.username).toBe(ai.name);
    expect(ai.avatar).toBeDefined();
    expect(ai.botLevel).toBeUndefined();
    expect(AI_PROFILES.some((p) => p.username === ai.username)).toBe(true);
    // In the game too: a connected human seat, no bot level anywhere.
    clock.advance(10 * SEC);
    const g = a.last('game')!;
    const seat = g.seats.find((x) => x.name === ai.name)!;
    expect(seat).toMatchObject({ kind: 'human', connected: true, botControlled: false });
    const config = g.view.players[seat.seat].config;
    expect(config).toMatchObject({ kind: 'human', name: ai.name });
    expect(config.botLevel).toBeUndefined();
  });

  it('people waiting together are matched with each other first', () => {
    const { clock, queue } = setup();
    const a = queue('Ana');
    clock.advance(2 * SEC);
    const b = queue('Bob');
    expect(b.last('joined')!.code).toBe(a.last('joined')!.code);
    expect(a.last('lobby')!.lobby.seats.map((s) => s.name)).toEqual(['Ana', 'Bob']);
  });

  it('a 3-5 search fills a table with distinct AI opponents next to whoever is waiting', () => {
    const { clock, queue } = setup();
    const a = queue('Ana', '3-5');
    clock.advance(1 * SEC);
    const b = queue('Bob', '3-5');
    clock.advance(4 * SEC);
    const seats = a.last('lobby')!.lobby.seats;
    expect(b.last('joined')!.code).toBe(a.last('joined')!.code);
    expect(seats).toHaveLength(3);
    expect(new Set(seats.map((s) => s.name)).size).toBe(3);
  });

  it('the search time is random between 5 and 20 s', () => {
    const { clock, queue } = setup({ random: () => 0.999 });
    const a = queue('Ana');
    clock.advance(19 * SEC);
    expect(a.last('joined')).toBeUndefined();
    clock.advance(1 * SEC);
    expect(a.last('joined')).toBeDefined();
  });

  it('the same player does not meet the same AI opponent again soon', () => {
    let i = 0;
    // A spread of random values so picks differ, deterministic.
    const { mgr, clock, queue } = setup({ random: () => ((i = (i * 7 + 3) % 97), i / 97) });
    const met: string[] = [];
    for (let g = 0; g < 30; g++) {
      const a = queue('acc-ana');
      clock.advance(21 * SEC);
      met.push(a.last('lobby')!.lobby.seats[1].name);
      mgr.onMessage(a, { t: 'leave' });
    }
    expect(new Set(met).size).toBe(30);
  });

  it('think before they pick, then the game plays to the end', () => {
    const { mgr, clock, queue, records } = setup();
    const a = queue('acc-ana', '1v1', 'ranked');
    clock.advance(15 * SEC);
    const g = a.last('game')!;
    expect(g.view.turn).toBe(1);
    mgr.onMessage(a, { t: 'act', action: g.legal[0] });
    // The AI has not picked yet.
    expect(a.last('game')!.view.turn).toBe(1);
    clock.advance(1_999);
    expect(a.last('game')!.view.turn).toBe(1);
    clock.advance(13 * SEC);
    expect(a.last('game')!.view.turn).toBe(2);
    playOut(mgr, clock, [a]);
    expect(records).toHaveLength(1);
    const [r] = records[0];
    expect(r).toMatchObject({ userId: 'acc-ana', kind: 'ranked', queue: '1v1', players: 2 });
    // random() = 0 gives the lowest offset in the ±50 band.
    expect(r.aiRivals).toEqual([{ place: expect.any(Number), offset: -50 }]);
    expect(r.won).toBe(r.place === 1);
  });

  it('leaving a ranked game against AI records a loss (last place) before the table closes', () => {
    const { mgr, clock, queue, records } = setup();
    const a = queue('acc-ana', '3-5', 'ranked');
    clock.advance(15 * SEC);
    mgr.onMessage(a, { t: 'leave' });
    expect(records).toHaveLength(1);
    expect(records[0][0]).toMatchObject({ userId: 'acc-ana', place: 3, won: false, kind: 'ranked', queue: '3-5' });
    expect(records[0][0].aiRivals).toHaveLength(2);
  });

  it('the table closes when the only person leaves', () => {
    const { mgr, clock, queue } = setup();
    const a = queue('Ana');
    clock.advance(15 * SEC);
    const code = a.last('joined')!.code;
    mgr.onMessage(a, { t: 'leave' });
    expect(mgr.room(code)!.closed).toBe(true);
  });

  it('rooms never get AI opponents: their bots are named Bot n', () => {
    const { mgr, clock } = setup();
    const a = new FakeConn('Ana');
    mgr.onMessage(a, { t: 'createRoom', name: 'Ana', settings: { sideMode: 'random', turnTimerMs: null, seats: 3, public: false, bots: 2, botLevel: 'hard' } });
    clock.advance(30 * SEC);
    expect(a.last('lobby')!.lobby.seats.map((s) => [s.name, s.kind]).sort()).toEqual([
      ['Ana', 'human'],
      ['Bot 1', 'bot'],
      ['Bot 2', 'bot'],
    ]);
  });
});

describe('ranked against AI opponents', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));
  function social() {
    const store = new MemoryStore();
    const clock = new ManualClock(1_000_000);
    const s = new Social(store, { roomOf: () => null, clock });
    const send = async (c: FakeConn, m: SocialMessage) => {
      await s.handle(c, m);
      await settle();
    };
    return { store, clock, s, send };
  }

  it('rates the person against AI ratings near their own, never stored or on leaderboards', async () => {
    const { s, send, clock } = social();
    const c = new FakeConn('ana');
    await send(c, { t: 'signup', username: 'Ana', password: 'secret1' });
    const ana = s.userOf(c)!;
    const rec = (place: number, aiRivals: GameRecord['aiRivals']): GameRecord => ({
      userId: ana.id,
      academyId: 'ember',
      score: 50,
      place,
      won: place === 1,
      players: 3,
      playedAt: clock.now(),
      kind: 'ranked',
      queue: '3-5',
      side: 'A',
      aiRivals,
    });
    // Beat two AI opponents rated like her: 32/2 * (0.5 + 0.5) = +16.
    await s.recordResults([rec(1, [{ place: 2, offset: 0 }, { place: 3, offset: 0 }])]);
    const board = await s.leaderboard(ana, '3-5', 'global');
    expect(board.rows.map((r) => [r.username, r.rating])).toEqual([['Ana', 1016]]);
    // Last behind two AI opponents rated 50 above and below her.
    await s.recordResults([rec(3, [{ place: 1, offset: 50 }, { place: 2, offset: -50 }])]);
    const after = await s.leaderboard(ana, '3-5', 'global');
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].rating).toBe(1016 - 16);
  });

  it('AI names cannot be signed up, and their profile shows little', async () => {
    const { send } = social();
    const name = AI_PROFILES[0].username;
    const c = new FakeConn('x');
    await send(c, { t: 'signup', username: name.toUpperCase(), password: 'secret1' });
    expect(c.lastError()).toBe('username_taken');
    await send(c, { t: 'profile', username: name });
    const p = c.last('profile')!.profile;
    expect(p).toMatchObject({ username: name, country: AI_PROFILES[0].country, me: false, recent: [], academies: [] });
    expect(p.totals.games).toBe(0);
    expect(p.ranked.every((r) => r.rating === null)).toBe(true);
  });
});
