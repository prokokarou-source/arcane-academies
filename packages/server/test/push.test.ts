import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import type { PushSub, SocialMessage } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { isPushEndpoint, pushFromEnv, type PushConfig } from '../src/push';
import type { Conn } from '../src/room';
import { Social } from '../src/social';
import { MemoryStore } from '../src/store';
import { FakeConn } from './fakes';

const settle = () => new Promise((r) => setTimeout(r, 0));
const sub = (id: string): PushSub => ({ endpoint: `https://push.example.com/${id}`, keys: { p256dh: 'p', auth: 'a' } });

/** A fake push service: records deliveries; endpoints listed in `fail` answer with that status. */
function fakeSender() {
  const sent: { endpoint: string; payload: Record<string, string> }[] = [];
  const fail = new Map<string, number>();
  const config: PushConfig = {
    publicKey: 'PUBLIC-KEY',
    send: async (s, payload) => {
      const status = fail.get(s.endpoint);
      if (status) throw Object.assign(new Error('push refused'), { statusCode: status });
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
    },
  };
  return { sent, fail, config };
}

function setup(push: PushConfig | null) {
  const store = new MemoryStore();
  const rooms = new Map<Conn, string>();
  const social = new Social(store, { roomOf: (c) => rooms.get(c) ?? null, clock: new ManualClock(0), push });
  const send = async (c: FakeConn, m: SocialMessage) => {
    await social.handle(c, m);
    await settle();
  };
  const signup = async (username: string) => {
    const c = new FakeConn(username);
    await send(c, { t: 'signup', username, password: 'secret1' });
    return c;
  };
  const friends = async () => {
    const a = await signup('Ana');
    const b = await signup('Bob');
    await send(a, { t: 'friendRequest', username: 'Bob' });
    await send(b, { t: 'friendAccept', username: 'Ana' });
    return { a, b };
  };
  const userId = async (name: string) => (await store.findUser(name))!.id;
  return { store, rooms, social, send, signup, friends, userId };
}

describe('push disabled (no VAPID keys)', () => {
  it('reads no config from an empty or partial environment', () => {
    expect(pushFromEnv({})).toBeNull();
    expect(pushFromEnv({ VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' })).toBeNull();
  });

  it('turns itself off with invalid keys instead of crashing', () => {
    expect(pushFromEnv({ VAPID_PUBLIC_KEY: 'bad', VAPID_PRIVATE_KEY: 'bad', VAPID_SUBJECT: 'mailto:a@example.com' })).toBeNull();
  });

  it('accepts a real key pair', () => {
    const keys = webpush.generateVAPIDKeys();
    const config = pushFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:a@example.com' });
    expect(config?.publicKey).toBe(keys.publicKey);
  });

  it('tells clients there is no key, stores nothing, and keeps the offline-invite error', async () => {
    const { send, friends, store, rooms, social, userId } = setup(null);
    const { a, b } = await friends();
    expect(a.last('pushKey')).toEqual({ t: 'pushKey', key: null });
    await send(b, { t: 'pushSubscribe', sub: sub('b') });
    expect(await store.pushSubs(await userId('Bob'))).toEqual([]);
    social.onClose(b);
    rooms.set(a, 'WAND-42');
    await send(a, { t: 'invite', username: 'Bob' });
    expect(a.lastError()).toBe('friend_offline');
  });
});

describe('push enabled', () => {
  it('sends the public key after login and saves subscriptions of the logged-in user only', async () => {
    const fake = fakeSender();
    const { send, signup, store, userId } = setup(fake.config);
    const guest = new FakeConn();
    await send(guest, { t: 'pushSubscribe', sub: sub('g') });
    expect(guest.lastError()).toBe('not_logged_in');

    const a = await signup('Ana');
    expect(a.last('pushKey')).toEqual({ t: 'pushKey', key: 'PUBLIC-KEY' });
    await send(a, { t: 'pushSubscribe', sub: sub('a') });
    // Endpoints that are not public push services are ignored.
    await send(a, { t: 'pushSubscribe', sub: { ...sub('x'), endpoint: 'https://127.0.0.1/x' } });
    expect(await store.pushSubs(await userId('Ana'))).toEqual([sub('a')]);
    await send(a, { t: 'pushUnsubscribe', endpoint: sub('a').endpoint });
    expect(await store.pushSubs(await userId('Ana'))).toEqual([]);
  });

  it('invites an offline friend by push, opening the room link', async () => {
    const fake = fakeSender();
    const { send, friends, rooms, social } = setup(fake.config);
    const { a, b } = await friends();
    await send(b, { t: 'pushSubscribe', sub: sub('b') });
    social.onClose(b);
    rooms.set(a, 'WAND 42');
    fake.sent.length = 0;
    await send(a, { t: 'invite', username: 'bob' });
    expect(a.lastError()).toBeUndefined();
    expect(fake.sent).toEqual([
      {
        endpoint: sub('b').endpoint,
        payload: { title: 'Ana invites you', body: 'Tap to join room WAND 42', url: '/?room=WAND%2042', tag: 'invite-WAND 42' },
      },
    ]);
  });

  it('also pushes to an online friend (the app may be in the background)', async () => {
    const fake = fakeSender();
    const { send, friends, rooms } = setup(fake.config);
    const { a, b } = await friends();
    await send(b, { t: 'pushSubscribe', sub: sub('b') });
    rooms.set(a, 'WAND-42');
    await send(a, { t: 'invite', username: 'Bob' });
    expect(b.last('invite')).toEqual({ t: 'invite', from: 'Ana', code: 'WAND-42' });
    expect(fake.sent.map((s) => s.payload.url)).toEqual(['/?room=WAND-42']);
  });

  it('reports an offline friend whose devices all failed, and forgets expired subscriptions', async () => {
    const fake = fakeSender();
    const { send, friends, rooms, social, store, userId } = setup(fake.config);
    const { a, b } = await friends();
    await send(b, { t: 'pushSubscribe', sub: sub('gone') });
    await send(b, { t: 'pushSubscribe', sub: sub('flaky') });
    fake.fail.set(sub('gone').endpoint, 410);
    fake.fail.set(sub('flaky').endpoint, 500);
    social.onClose(b);
    rooms.set(a, 'WAND-42');
    await send(a, { t: 'invite', username: 'Bob' });
    expect(a.lastError()).toBe('friend_offline');
    expect(await store.pushSubs(await userId('Bob'))).toEqual([sub('flaky')]);
  });

  it('notifies a new friend request, but not when the request is accepted by asking back', async () => {
    const fake = fakeSender();
    const { send, signup } = setup(fake.config);
    const a = await signup('Ana');
    const b = await signup('Bob');
    await send(a, { t: 'pushSubscribe', sub: sub('a') });
    await send(b, { t: 'pushSubscribe', sub: sub('b') });
    await send(a, { t: 'friendRequest', username: 'bob' });
    expect(fake.sent).toEqual([
      { endpoint: sub('b').endpoint, payload: { title: 'Friend request', body: 'Ana wants to be your friend', url: '/', tag: 'friend-Ana' } },
    ]);
    await send(b, { t: 'friendRequest', username: 'Ana' });
    expect(fake.sent).toHaveLength(1);
  });
});

describe('isPushEndpoint', () => {
  it('allows https push hosts only', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/xyz')).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/a', 'https://localhost/a', 'https://10.0.0.1/a', 'https://[::1]/a', 'https://intranet/a', 'nope'])
      expect(isPushEndpoint(bad)).toBe(false);
  });
});
