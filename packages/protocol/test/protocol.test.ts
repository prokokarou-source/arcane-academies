import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, AVATAR_ICONS, avatarKey, DEFAULT_ROOM_CONFIG, encode, isSocialMessage, parseAvatarKey, parseClientMessage, MAX_MESSAGE_BYTES, REACTIONS } from '../src/index';
import type { ClientMessage, ServerMessage } from '../src/index';

const plan = { buyLeft: { ink: 1 }, buyRight: {}, coinsToLeft: 2, coinsToRight: 0, coinsToBank: 0, free: false };

const samples: ClientMessage[] = [
  { t: 'create', name: 'Ana' },
  { t: 'join', code: 'WAND-42', name: 'Bob' },
  { t: 'rejoin', code: 'WAND-42', token: 'a'.repeat(32) },
  { t: 'leave' },
  { t: 'setSeat', seatId: 's2', name: 'Cy', academyId: 'pyromancy' },
  { t: 'setSeat', academyId: null },
  { t: 'addBot', level: 'hard' },
  { t: 'removeSeat', seatId: 's3' },
  { t: 'setBotLevel', seatId: 's3', level: 'easy' },
  { t: 'settings', settings: { graceMs: 30000, turnTimerMs: null } },
  { t: 'start' },
  { t: 'act', action: { type: 'build', cardUid: 'c1#0', payment: plan } },
  { t: 'act', action: { type: 'tower', cardUid: 'c1#0', payment: { ...plan, free: true } } },
  { t: 'act', action: { type: 'sell', cardUid: 'c1#0' } },
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
          config: DEFAULT_ROOM_CONFIG,
          kind: 'room',
          seats: [{ id: 's1', kind: 'human', name: 'Ana', academyId: null, connected: true }],
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
      JSON.stringify({ t: 'setSeat', name: 7 }),
      JSON.stringify({ t: 'create', name: 'a'.repeat(MAX_MESSAGE_BYTES) }),
    ];
    for (const raw of bad) expect(parseClientMessage(raw), raw.slice(0, 80)).toBeNull();
  });

  it('trims names and drops unknown fields', () => {
    expect(parseClientMessage('{"t":"create","name":"  Ana  ","evil":1}')).toEqual({ t: 'create', name: 'Ana' });
  });
});

describe('account messages', () => {
  it('round-trip and are recognised as social', async () => {
    const { isSocialMessage } = await import('../src/index');
    const msgs: ClientMessage[] = [
      { t: 'signup', username: 'Ana', password: 'secret1' },
      { t: 'login', username: 'Ana', password: 'secret1' },
      { t: 'auth', token: 'x'.repeat(43) },
      { t: 'logout' },
      { t: 'friendRequest', username: 'Bob' },
      { t: 'friendAccept', username: 'Bob' },
      { t: 'friendRemove', username: 'Bob' },
      { t: 'invite', username: 'Bob' },
    ];
    for (const m of msgs) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(true);
    }
    expect(isSocialMessage({ t: 'create', name: 'Ana' })).toBe(false);
  });

  it('rejects malformed account messages', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'login', username: 'Ana' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'signup', username: '', password: 'x' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'login', username: 'Ana', password: 'x'.repeat(129) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'invite', username: 7 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'auth' }))).toBeNull();
  });
});

describe('queue messages', () => {
  it('round-trip and are room messages', () => {
    const msgs: ClientMessage[] = [
      { t: 'queueJoin', kind: 'casual', queue: '1v1', name: 'Ana' },
      { t: 'queueJoin', kind: 'ranked', queue: '6-7', name: 'Ana' },
      { t: 'queueLeave' },
    ];
    for (const m of msgs) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(false);
    }
    const server: ServerMessage[] = [
      { t: 'queueState', kind: 'ranked', queue: '3-5', searching: 2, waitedMs: 1500 },
      { t: 'queueLeft' },
    ];
    for (const m of server) expect(JSON.parse(encode(m))).toEqual(m);
  });

  it('rejects a bad kind, queue or name, and the old quick-match messages', () => {
    const q = (v: object) => parseClientMessage(JSON.stringify({ t: 'queueJoin', ...v }));
    expect(q({ kind: 'casual', queue: '2', name: 'Ana' })).toBeNull();
    expect(q({ kind: 'bots', queue: '1v1', name: 'Ana' })).toBeNull();
    expect(q({ queue: '1v1', name: 'Ana' })).toBeNull();
    expect(q({ kind: 'casual', queue: '1v1', name: ' ' })).toBeNull();
    expect(q({ kind: 'casual', queue: '1v1', name: '  Ana ', x: 1 })).toEqual({ t: 'queueJoin', kind: 'casual', queue: '1v1', name: 'Ana' });
    for (const t of ['quickMatch', 'quickCancel', 'quickBots']) expect(parseClientMessage(JSON.stringify({ t, name: 'Ana', size: 2 }))).toBeNull();
  });
});

describe('room messages', () => {
  const config = { sideMode: 'B', turnTimerMs: 60000, seats: 5, public: true, bots: 2, botLevel: 'hard' } as const;

  it('round-trip', () => {
    const msgs: ClientMessage[] = [
      { t: 'createRoom', name: 'Ana', settings: config },
      { t: 'createRoom', name: 'Ana', settings: { ...config, sideMode: 'random', turnTimerMs: null } },
      { t: 'joinRoom', code: 'WAND-42', name: 'Bob' },
      { t: 'roomConfig', settings: { seats: 4 } },
      { t: 'roomConfig', settings: config },
      { t: 'roomConfig', settings: { turnTimerMs: null } },
      { t: 'roomsWatch' },
      { t: 'roomsUnwatch' },
    ];
    for (const m of msgs) expect(parseClientMessage(encode(m))).toEqual(m);
    const server: ServerMessage[] = [
      { t: 'rooms', rooms: [{ code: 'WAND-42', host: 'Ana', sideMode: 'random', turnTimerMs: null, seats: 4, taken: 2, bots: 1 }] },
      {
        t: 'game',
        view: {} as never,
        legal: [],
        seats: [],
        deadline: null,
        reveal: { side: 'B', academies: [{ seat: 0, academyId: 'pyromancy' }] },
      },
    ];
    for (const m of server) expect(JSON.parse(encode(m))).toEqual(m);
  });

  it('rejects malformed settings', () => {
    const create = (settings: unknown) => parseClientMessage(JSON.stringify({ t: 'createRoom', name: 'Ana', settings }));
    expect(create({ ...config, seats: undefined })).toBeNull();
    expect(create({ ...config, sideMode: 'C' })).toBeNull();
    expect(create({ ...config, seats: 2.5 })).toBeNull();
    expect(create({ ...config, public: 'yes' })).toBeNull();
    expect(create({ ...config, botLevel: 'insane' })).toBeNull();
    expect(create({ ...config, turnTimerMs: '60' })).toBeNull();
    expect(create(null)).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'roomConfig', settings: { bots: -0.5 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'roomConfig', settings: { seats: 3, extra: 1 } }))).toEqual({ t: 'roomConfig', settings: { seats: 3 } });
    expect(parseClientMessage(JSON.stringify({ t: 'joinRoom', code: '', name: 'Bob' }))).toBeNull();
  });

  it('setSeat no longer carries a side', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'setSeat', academyId: 'pyromancy', side: 'B' }))).toEqual({ t: 'setSeat', academyId: 'pyromancy' });
  });
});

describe('reactions', () => {
  it('accepts every reaction id and nothing else', () => {
    for (const reaction of REACTIONS) expect(parseClientMessage(encode({ t: 'react', reaction }))).toEqual({ t: 'react', reaction });
    for (const bad of ['hello', '', 7, null, undefined, 'CLAP', { id: 'clap' }]) {
      expect(parseClientMessage(JSON.stringify({ t: 'react', reaction: bad }))).toBeNull();
    }
    expect(parseClientMessage(JSON.stringify({ t: 'react', reaction: 'gg', text: 'free text' }))).toEqual({ t: 'react', reaction: 'gg' });
    expect(isSocialMessage({ t: 'react', reaction: 'gg' })).toBe(false);
  });
});

describe('stats and account management messages', () => {
  it('round-trip and are recognised as social', async () => {
    const { isSocialMessage } = await import('../src/index');
    const msgs: ClientMessage[] = [
      { t: 'profile' },
      { t: 'leaderboard' },
      { t: 'changePassword', current: 'secret1', next: 'secret2' },
      { t: 'logoutAll' },
      { t: 'deleteAccount', password: 'secret1' },
    ];
    for (const m of msgs) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(true);
    }
  });

  it('drops unknown fields and rejects malformed ones', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'profile', username: 'Bob' }))).toEqual({ t: 'profile' });
    expect(parseClientMessage(JSON.stringify({ t: 'changePassword', current: 'secret1' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'changePassword', current: 'a', next: 'x'.repeat(129) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'deleteAccount' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'deleteAccount', password: 12 }))).toBeNull();
  });
});

describe('push messages', () => {
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'BPk', auth: 'aut' } };

  it('round-trip, are social, and drop extra fields', () => {
    for (const m of [{ t: 'pushSubscribe', sub }, { t: 'pushUnsubscribe', endpoint: sub.endpoint }] as ClientMessage[]) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(true);
    }
    const extra = { t: 'pushSubscribe', sub: { ...sub, expirationTime: null, keys: { ...sub.keys, x: 1 } } };
    expect(parseClientMessage(JSON.stringify(extra))).toEqual({ t: 'pushSubscribe', sub });
  });

  it('rejects non-https endpoints and missing keys', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'pushSubscribe', sub: { ...sub, endpoint: 'http://push.example.com/a' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'pushSubscribe', sub: { endpoint: sub.endpoint } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'pushSubscribe', sub: { ...sub, keys: { p256dh: 'x' } } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'pushUnsubscribe', endpoint: 'file:///etc' }))).toBeNull();
  });
});

describe('block, report and recovery messages', () => {
  it('round-trip and are recognised as social', () => {
    const msgs: ClientMessage[] = [
      { t: 'block', username: 'Bob' },
      { t: 'unblock', username: 'Bob' },
      { t: 'report', username: 'Bob', reason: 'harassment', note: 'rude in chat' },
      { t: 'report', username: 'Bob', reason: 'cheating', note: '' },
      { t: 'recover', username: 'Ana', code: 'ABCD-EFGH-JKMN-PQRS', password: 'secret9' },
      { t: 'createRecoveryCode', password: 'secret1' },
    ];
    for (const m of msgs) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(true);
    }
  });

  it('defaults and trims the report note, and rejects malformed ones', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'report', username: 'Bob', reason: 'name' }))).toEqual({
      t: 'report',
      username: 'Bob',
      reason: 'name',
      note: '',
    });
    expect(parseClientMessage(JSON.stringify({ t: 'report', username: 'Bob', reason: 'other', note: '  hi ' }))).toMatchObject({ note: 'hi' });
    expect(parseClientMessage(JSON.stringify({ t: 'report', username: 'Bob', reason: 'spam', note: '' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'report', username: 'Bob', reason: 'other', note: 'x'.repeat(201) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'report', username: 'Bob', reason: 'other', note: 5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'block' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'recover', username: 'Ana', code: '', password: 'secret9' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'recover', username: 'Ana', code: 'A'.repeat(65), password: 'secret9' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'createRecoveryCode' }))).toBeNull();
  });

  it('normalizes recovery codes typed with spaces, dashes or lower case', async () => {
    const { normalizeRecoveryCode, RECOVERY_ALPHABET } = await import('../src/index');
    expect(normalizeRecoveryCode(' abcd-efgh jkmn-pqrs ')).toBe('ABCDEFGHJKMNPQRS');
    expect(RECOVERY_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('server messages survive JSON', () => {
    const msgs: ServerMessage[] = [
      { t: 'blocked', list: ['Bob'] },
      { t: 'reported', username: 'Bob' },
      { t: 'recoveryCode', code: 'ABCD-EFGH-JKMN-PQRS' },
    ];
    for (const m of msgs) expect(JSON.parse(encode(m))).toEqual(m);
  });
});

describe('rematch messages', () => {
  it('round-trip and are room messages', () => {
    for (const m of [{ t: 'playAgain', ready: true }, { t: 'playAgain', ready: false }, { t: 'playAgainNow' }, { t: 'rematch' }] as ClientMessage[]) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(false);
    }
  });

  it('rejects a missing or non-boolean ready flag', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'playAgain' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'playAgain', ready: 'yes' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'playAgainNow', extra: 1 }))).toEqual({ t: 'playAgainNow' });
  });
});

describe('avatars', () => {
  it('has 16 emblems and 8 colours', () => {
    expect(AVATAR_ICONS).toHaveLength(16);
    expect(AVATAR_COLORS).toHaveLength(8);
  });

  it('setAvatar round-trips, is social, and drops extra fields', () => {
    for (const m of [{ t: 'setAvatar', avatar: { icon: 'owl', color: 'teal' } }, { t: 'setAvatar', avatar: null }] as ClientMessage[]) {
      expect(parseClientMessage(encode(m))).toEqual(m);
      expect(isSocialMessage(m)).toBe(true);
    }
    expect(parseClientMessage(JSON.stringify({ t: 'setAvatar', avatar: { icon: 'key', color: 'gold', x: 1 } }))).toEqual({
      t: 'setAvatar',
      avatar: { icon: 'key', color: 'gold' },
    });
  });

  it('rejects unknown emblems and colours', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'setAvatar' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'setAvatar', avatar: { icon: 'dragon', color: 'gold' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'setAvatar', avatar: { icon: 'owl', color: 'pink' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'setAvatar', avatar: 'owl:gold' }))).toBeNull();
  });

  it('stores as icon:color and reads back only valid keys', () => {
    expect(avatarKey({ icon: 'comet', color: 'rose' })).toBe('comet:rose');
    expect(parseAvatarKey('comet:rose')).toEqual({ icon: 'comet', color: 'rose' });
    expect(parseAvatarKey('comet:pink')).toBeNull();
    expect(parseAvatarKey(null)).toBeNull();
    expect(parseAvatarKey('')).toBeNull();
  });
});
