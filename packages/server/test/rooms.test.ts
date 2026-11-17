import { describe, expect, it } from 'vitest';
import type { RoomConfig } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { RoomManager } from '../src/manager';
import { FakeConn, playToEnd } from './fakes';

const CONFIG: RoomConfig = { sideMode: 'random', turnTimerMs: null, seats: 4, public: true, bots: 1, botLevel: 'hard' };

function setup() {
  const clock = new ManualClock(1_000_000);
  const mgr = new RoomManager({ clientUrl: 'http://client', seed: () => 7, roomsThrottleMs: 1000 }, clock);
  const create = (name: string, settings: Partial<RoomConfig> = {}) => {
    const c = new FakeConn(name);
    mgr.onMessage(c, { t: 'createRoom', name, settings: { ...CONFIG, ...settings } });
    return c;
  };
  const join = (code: string, name: string) => {
    const c = new FakeConn(name);
    mgr.onMessage(c, { t: 'joinRoom', code, name });
    return c;
  };
  const code = (c: FakeConn) => c.last('joined')!.code;
  return { clock, mgr, create, join, code };
}

describe('rooms', () => {
  it('createRoom seats the bots and keeps their seats apart from humans', () => {
    const { mgr, create, join, code } = setup();
    const a = create('Ana', { seats: 3, bots: 1 });
    const lobby = a.last('lobby')!.lobby;
    expect(lobby).toMatchObject({ kind: 'room', config: { ...CONFIG, seats: 3, bots: 1 } });
    expect(lobby.seats.map((s) => [s.kind, s.botLevel])).toEqual([
      ['bot', 'hard'],
      ['human', undefined],
    ]);
    const b = join(code(a), 'Bob');
    expect(b.last('lobby')!.lobby.seats).toHaveLength(3);
    const c = join(code(a), 'Cy');
    expect(c.lastError()).toBe('room_full');
    // The older create/join still work: a private room with the defaults.
    const e = new FakeConn('Ed');
    const d = new FakeConn('Di');
    mgr.onMessage(e, { t: 'create', name: 'Ed' });
    mgr.onMessage(d, { t: 'join', code: code(e), name: 'Di' });
    expect(d.last('lobby')!.lobby).toMatchObject({ kind: 'room', config: { public: false, seats: 7, bots: 0 } });
  });

  it('rejects bad settings on create and in the lobby', () => {
    const { mgr, create, join, code } = setup();
    for (const bad of [{ seats: 8 }, { seats: 1, bots: 0 }, { seats: 3, bots: 3 }, { turnTimerMs: 1000 }]) {
      const c = create('Ana', bad);
      expect(c.lastError(), JSON.stringify(bad)).toBe('bad_settings');
      expect(c.last('joined')).toBeUndefined();
    }
    expect(mgr.size()).toBe(0);
    const a = create('Ana', { seats: 4, bots: 1 });
    const b = join(code(a), 'Bob');
    const c = join(code(a), 'Cy');
    const before = JSON.stringify(a.last('lobby'));
    mgr.onMessage(b, { t: 'roomConfig', settings: { seats: 5 } });
    expect(b.lastError()).toBe('not_host');
    // Three humans are here: two bots would need five seats.
    mgr.onMessage(a, { t: 'roomConfig', settings: { bots: 2 } });
    expect(a.lastError()).toBe('bad_settings');
    mgr.onMessage(a, { t: 'roomConfig', settings: { seats: 3 } });
    expect(a.lastError()).toBe('bad_settings');
    mgr.onMessage(a, { t: 'roomConfig', settings: { turnTimerMs: 5 } });
    expect(a.lastError()).toBe('bad_settings');
    expect(JSON.stringify(a.last('lobby'))).toBe(before);
    expect(c.last('lobby')!.lobby.seats).toHaveLength(4);
  });

  it('roomConfig adds and removes bots with one level for all', () => {
    const { mgr, create } = setup();
    const a = create('Ana', { seats: 7, bots: 1 });
    mgr.onMessage(a, { t: 'roomConfig', settings: { bots: 4, botLevel: 'easy', sideMode: 'B', turnTimerMs: 60_000 } });
    let lobby = a.last('lobby')!.lobby;
    expect(lobby.seats.filter((s) => s.kind === 'bot').map((s) => s.botLevel)).toEqual(['easy', 'easy', 'easy', 'easy']);
    expect(lobby.config).toMatchObject({ bots: 4, botLevel: 'easy', sideMode: 'B', turnTimerMs: 60_000 });
    expect(lobby.settings.turnTimerMs).toBe(60_000);
    mgr.onMessage(a, { t: 'roomConfig', settings: { bots: 2 } });
    lobby = a.last('lobby')!.lobby;
    expect(lobby.seats.filter((s) => s.kind === 'bot')).toHaveLength(2);
    // Removing a bot seat or setting one bot's level speaks for all bots.
    const bot = lobby.seats.find((s) => s.kind === 'bot')!;
    mgr.onMessage(a, { t: 'setBotLevel', seatId: bot.id, level: 'hard' });
    expect(a.last('lobby')!.lobby.seats.filter((s) => s.kind === 'bot').every((s) => s.botLevel === 'hard')).toBe(true);
    mgr.onMessage(a, { t: 'removeSeat', seatId: bot.id });
    expect(a.last('lobby')!.lobby.config.bots).toBe(1);
  });

  it('lists public lobby rooms with a free seat, live and throttled, while watched', () => {
    const { mgr, clock, create, join, code } = setup();
    const w = new FakeConn('watcher');
    const pub = create('Ana', { seats: 3, bots: 1 });
    create('Pat', { public: false });
    mgr.onMessage(w, { t: 'roomsWatch' });
    expect(w.last('rooms')!.rooms).toEqual([
      { code: code(pub), host: 'Ana', sideMode: 'random', turnTimerMs: null, seats: 3, taken: 2, bots: 1 },
    ]);
    const sent = () => w.sent.filter((m) => m.t === 'rooms').length;
    expect(sent()).toBe(1);
    // A new room shows at once; a second change within the throttle waits.
    const other = create('Cy', { seats: 5, bots: 0 });
    expect(sent()).toBe(2);
    expect(w.last('rooms')!.rooms).toHaveLength(2);
    const b = join(code(pub), 'Bob');
    expect(sent()).toBe(2);
    clock.advance(1000);
    expect(sent()).toBe(3);
    // Full now: gone from the list.
    expect(w.last('rooms')!.rooms.map((r) => r.code)).toEqual([code(other)]);
    mgr.onMessage(b, { t: 'leave' });
    clock.advance(1000);
    expect(w.last('rooms')!.rooms.map((r) => r.code)).toEqual([code(pub), code(other)]);
    // A started room leaves the list.
    mgr.onMessage(pub, { t: 'start' });
    clock.advance(1000);
    expect(w.last('rooms')!.rooms.map((r) => r.code)).toEqual([code(other)]);
    // Unwatched: no more updates.
    mgr.onMessage(w, { t: 'roomsUnwatch' });
    const n = sent();
    create('Di');
    clock.advance(5000);
    expect(sent()).toBe(n);
    // A listed room is joined by its code.
    const t = join(code(other), 'Tap');
    expect(t.last('lobby')!.lobby.code).toBe(code(other));
  });

  it('academies: first come first served, unpicked drawn at start', () => {
    const { mgr, create, join, code } = setup();
    const a = create('Ana', { seats: 4, bots: 1 });
    const b = join(code(a), 'Bob');
    const c = join(code(a), 'Cy');
    mgr.onMessage(a, { t: 'setSeat', academyId: 'pyromancy' });
    mgr.onMessage(b, { t: 'setSeat', academyId: 'pyromancy' });
    expect(b.lastError()).toBe('academy_taken');
    mgr.onMessage(b, { t: 'setSeat', academyId: 'verdant' });
    mgr.onMessage(a, { t: 'start' });
    const room = mgr.room(code(a))!;
    const ids = room.state!.players.map((p) => p.academyId);
    expect(new Set(ids).size).toBe(4);
    const me = (x: FakeConn) => x.last('game')!.view.players[x.last('game')!.view.me].academyId;
    expect(me(a)).toBe('pyromancy');
    expect(me(b)).toBe('verdant');
    expect(me(c)).toBeTruthy();
  });

  it('plays one side for the whole table: the host choice, or one random draw', () => {
    for (const sideMode of ['A', 'B', 'random'] as const) {
      const { mgr, create, join, code } = setup();
      const a = create('Ana', { sideMode, seats: 4, bots: 2 });
      join(code(a), 'Bob');
      mgr.onMessage(a, { t: 'start' });
      const sides = new Set(mgr.room(code(a))!.state!.players.map((p) => p.side));
      expect(sides.size).toBe(1);
      const reveal = a.last('game')!.reveal!;
      expect(sides.has(reveal.side)).toBe(true);
      if (sideMode !== 'random') expect(reveal.side).toBe(sideMode);
    }
  });

  it('sends the reveal once per game, again for the next game', () => {
    const { mgr, create, join, code } = setup();
    const a = create('Ana', { seats: 3, bots: 1 });
    const b = join(code(a), 'Bob');
    mgr.onMessage(a, { t: 'start' });
    const room = mgr.room(code(a))!;
    const reveals = (c: FakeConn) => c.sent.filter((m) => m.t === 'game' && m.reveal);
    for (const c of [a, b]) {
      const first = c.sent.find((m) => m.t === 'game');
      expect(first?.t === 'game' && first.reveal?.academies.map((x) => x.academyId)).toEqual(room.state!.players.map((p) => p.academyId));
    }
    mgr.onMessage(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.reveal).toBeUndefined();
    playToEnd(room, [a, b]);
    expect(reveals(a)).toHaveLength(1);
    mgr.onMessage(a, { t: 'playAgain', ready: true });
    mgr.onMessage(b, { t: 'playAgain', ready: true });
    expect(reveals(a)).toHaveLength(2);
    expect(reveals(b)).toHaveLength(2);
  });
});
