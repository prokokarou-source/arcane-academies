import { describe, expect, it } from 'vitest';
import { encode, parseClientMessage, MAX_MESSAGE_BYTES } from '../src/index';
import type { ClientMessage, ServerMessage } from '../src/index';

const plan = { buyLeft: { ink: 1 }, buyRight: {}, coinsToLeft: 2, coinsToRight: 0, coinsToBank: 0, free: false };

const samples: ClientMessage[] = [
  { t: 'create', name: 'Ana' },
  { t: 'join', code: 'WAND-42', name: 'Bob' },
  { t: 'rejoin', code: 'WAND-42', token: 'a'.repeat(32) },
  { t: 'leave' },
  { t: 'setSeat', seatId: 's2', name: 'Cy', academyId: 'pyromancy', side: 'B' },
  { t: 'setSeat', academyId: null },
  { t: 'addBot', level: 'hard' },
  { t: 'removeSeat', seatId: 's3' },
  { t: 'setBotLevel', seatId: 's3', level: 'easy' },
  { t: 'settings', settings: { graceMs: 30000, turnTimerMs: null } },
  { t: 'start' },
  { t: 'act', action: { type: 'build', cardUid: 'c1#0', payment: plan } },
  { t: 'act', action: { type: 'tower', cardUid: 'c1#0', payment: { ...plan, free: true } } },
  { t: 'act', action: { type: 'sell', cardUid: 'c1#0' } },
  { t: 'act', action: { type: 'chronoKeep', cardUid: 'c1#0' } },
  { t: 'rematch' },
];

describe('protocol', () => {
  it('round-trips every client message', () => {
    for (const m of samples) expect(parseClientMessage(encode(m))).toEqual(m);
  });

  it('round-trips server messages through JSON', () => {
    const msgs: ServerMessage[] = [
      { t: 'error', code: 'not_host', message: 'Only the host can do that' },
      {
        t: 'lobby',
        lobby: {
          code: 'WAND-42',
          inviteUrl: 'http://x/?room=WAND-42',
          hostId: 's1',
          settings: { graceMs: 60000, turnTimerMs: null },
          seats: [{ id: 's1', kind: 'human', name: 'Ana', academyId: null, side: 'A', connected: true }],
        },
      },
    ];
    for (const m of msgs) expect(JSON.parse(encode(m))).toEqual(m);
  });

  it('rejects malformed input', () => {
    const act = (action: unknown) => JSON.stringify({ t: 'act', action });
    const bad = [
      'not json',
      '[]',
      'null',
      '{"t":"nope"}',
      JSON.stringify({ t: 'join', name: 'x' }),
      JSON.stringify({ t: 'join', code: 'WAND-42', name: 'x'.repeat(21) }),
      JSON.stringify({ t: 'join', code: 'WAND-42', name: '   ' }),
      JSON.stringify({ t: 'addBot', level: 'insane' }),
      act({ type: 'sell', cardUid: 5 }),
      act({ type: 'build', cardUid: 'c', payment: { ...plan, coinsToLeft: -1 } }),
      act({ type: 'build', cardUid: 'c', payment: { ...plan, coinsToBank: 1.5 } }),
      act({ type: 'build', cardUid: 'c', payment: { ...plan, buyLeft: { gold: 1 } } }),
      act({ type: 'build', cardUid: 'c', payment: { ...plan, free: 'yes' } }),
      act({ type: 'build', cardUid: 'c' }),
      act({ type: 'steal', cardUid: 'c' }),
      JSON.stringify({ t: 'settings', settings: { graceMs: '60' } }),
      JSON.stringify({ t: 'setSeat', side: 'C' }),
      JSON.stringify({ t: 'create', name: 'a'.repeat(MAX_MESSAGE_BYTES) }),
    ];
    for (const raw of bad) expect(parseClientMessage(raw), raw.slice(0, 80)).toBeNull();
  });

  it('trims names and drops unknown fields', () => {
    expect(parseClientMessage('{"t":"create","name":"  Ana  ","evil":1}')).toEqual({ t: 'create', name: 'Ana' });
  });
});
