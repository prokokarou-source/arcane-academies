import { describe, expect, it } from 'vitest';
import type { Action } from '@arcane/engine';
import type { ServerMessage } from '@arcane/protocol';
import type { Room } from '../src/room';
import { lobbyWith, playToEnd } from './fakes';

const HIDDEN_KEYS = ['"rngState":', '"seed":', '"pending":', '"towerCards":'];

/** Throw if a message exposes anything another seat should keep hidden. */
function assertNoLeak(room: Room | undefined, m: ServerMessage) {
  const json = JSON.stringify(m);
  for (const k of HIDDEN_KEYS) if (json.includes(k)) throw new Error(`leaked key ${k}`);
  const s = room?.state;
  if (!s || m.t !== 'game') return;
  for (const p of s.players) {
    if (p.seat === m.view.me) continue;
    const secret = [...p.hand, ...p.towerCards, ...(s.kept[p.seat] ? [s.kept[p.seat]!] : [])];
    for (const c of secret) if (json.includes(`"${c.uid}"`)) throw new Error(`seat ${m.view.me} saw ${c.uid} of seat ${p.seat}`);
  }
}

describe('room game loop', () => {
  it('rejects illegal and out-of-phase actions', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'act', action: { type: 'sell', cardUid: 'x' } });
    expect(a.lastError()).toBe('wrong_phase');
    room.handle(a, { t: 'start' });
    const bHand = b.last('game')!.view.players[2].hand!;
    room.handle(a, { t: 'act', action: { type: 'sell', cardUid: bHand[0].uid } });
    expect(a.lastError()).toBe('illegal_action');
    room.handle(a, { t: 'act', action: { type: 'sell', cardUid: 'nope' } });
    expect(a.lastError()).toBe('illegal_action');
    expect(room.state!.players[0].pending).toBeUndefined();
  });

  it('resolves at once when the only human acts and the others are bots', () => {
    const { room, conns } = lobbyWith(['Ana']);
    const [a] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.handle(a, { t: 'addBot', level: 'hard' });
    room.handle(a, { t: 'start' });
    expect(a.last('game')!.view.turn).toBe(1);
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.view.turn).toBe(2);
    expect(a.last('game')!.seats.map((s) => s.kind)).toEqual(['human', 'bot', 'bot']);
  });

  it('accepts a build sent back as a fresh copy of an offered plan', () => {
    const { room, conns } = lobbyWith(['Ana']);
    const [a] = conns;
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.handle(a, { t: 'start' });
    const build = a.last('game')!.legal.find((x) => x.type === 'build')!;
    room.handle(a, { t: 'act', action: JSON.parse(JSON.stringify(build)) as Action });
    expect(a.lastError()).toBeUndefined();
    expect(a.last('game')!.view.turn).toBe(2);
  });

  it('plays a full 3-human game (with the Chronomancy bonus phase) and never leaks hidden cards', () => {
    let room!: Room;
    const phases = new Set<string>();
    const setup = lobbyWith(['Ana', 'Bob', 'Cy'], {}, (m) => {
      assertNoLeak(room, m);
      if (m.t === 'game') phases.add(m.view.phase);
    });
    room = setup.room;
    const [a] = setup.conns;
    room.handle(a, { t: 'setSeat', academyId: 'chronomancy' });
    room.handle(a, { t: 'start' });
    const prefer = (legal: Action[]) =>
      legal.find((x) => x.type === 'chronoKeep') ?? legal.find((x) => x.type === 'tower') ?? legal[0];
    playToEnd(room, setup.conns, prefer);
    expect(room.state!.phase).toBe('ended');
    expect(phases.has('bonus')).toBe(true);
    const result = a.last('game')!.result!;
    expect(result.scores).toHaveLength(3);
    for (const c of setup.conns) expect(c.last('game')!.result).toEqual(result);
  });

  it('a host and one bot play a 2-seat game with the Archmage', () => {
    const { room, conns } = lobbyWith(['Ana']);
    const [a] = conns;
    room.handle(a, { t: 'addBot', level: 'hard' });
    room.handle(a, { t: 'start' });
    expect(a.last('game')!.seats.map((s) => s.kind)).toEqual(['human', 'archmage', 'bot']);
    playToEnd(room, [a]);
    expect(a.last('game')!.result!.winners).not.toContain(1);
  });

  it('only offers actions to seats that still have to act', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(a, { t: 'start' });
    room.handle(a, { t: 'act', action: a.last('game')!.legal[0] });
    expect(a.last('game')!.legal).toEqual([]);
    expect(b.last('game')!.legal.length).toBeGreaterThan(0);
    expect(b.last('game')!.view.players[0].hasSubmitted).toBe(true);
  });
});
