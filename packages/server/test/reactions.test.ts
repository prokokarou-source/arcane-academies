import { describe, expect, it } from 'vitest';
import { REACTION_BURST, REACTION_REFILL_MS } from '@arcane/protocol';
import { FakeConn, lobbyWith, playToEnd } from './fakes';

const reactions = (c: { sent: { t: string }[] }) => c.sent.filter((m) => m.t === 'reaction');

describe('room reactions', () => {
  it('broadcasts a reaction with the sender seat to everyone in the lobby', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    room.handle(b, { t: 'react', reaction: 'clap' });
    const sid = b.last('joined')!.seatId;
    for (const c of [a, b]) expect(c.last('reaction')).toEqual({ t: 'reaction', seatId: sid, seat: null, reaction: 'clap' });
  });

  it('carries the engine seat during a game', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob', 'Cleo']);
    const [a, , c] = conns;
    room.handle(a, { t: 'start' });
    room.handle(c, { t: 'react', reaction: 'gg' });
    expect(a.last('reaction')).toMatchObject({ seat: c.last('game')!.view.me, reaction: 'gg' });
  });

  it('rate-limits each seat: a short burst, then one per refill period', () => {
    const { room, clock, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    for (let i = 0; i < REACTION_BURST + 3; i++) room.handle(a, { t: 'react', reaction: 'fire' });
    expect(reactions(b)).toHaveLength(REACTION_BURST);
    expect(a.lastError()).toBeUndefined();
    // Bob has his own budget.
    room.handle(b, { t: 'react', reaction: 'wow' });
    expect(reactions(b)).toHaveLength(REACTION_BURST + 1);
    clock.advance(REACTION_REFILL_MS / 2);
    room.handle(a, { t: 'react', reaction: 'fire' });
    expect(reactions(b)).toHaveLength(REACTION_BURST + 1);
    clock.advance(REACTION_REFILL_MS / 2);
    room.handle(a, { t: 'react', reaction: 'fire' });
    room.handle(a, { t: 'react', reaction: 'fire' });
    expect(reactions(b)).toHaveLength(REACTION_BURST + 2);
    // A long pause refills only up to the burst size.
    clock.advance(REACTION_REFILL_MS * 100);
    for (let i = 0; i < REACTION_BURST + 2; i++) room.handle(a, { t: 'react', reaction: 'fire' });
    expect(reactions(b)).toHaveLength(2 * REACTION_BURST + 2);
  });

  it('refuses conns outside the room; bots and bot-played seats never react', () => {
    const { room, conns } = lobbyWith(['Ana', 'Bob']);
    const [a, b] = conns;
    const stranger = new FakeConn('Eve');
    room.handle(stranger, { t: 'react', reaction: 'laugh' });
    expect(stranger.lastError()).toBe('not_in_room');
    room.handle(a, { t: 'addBot', level: 'easy' });
    room.handle(a, { t: 'start' });
    room.handle(b, { t: 'leave' });
    playToEnd(room, [a]);
    expect(reactions(a)).toHaveLength(0);
  });
});
