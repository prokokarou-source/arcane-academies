import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectivity, createInstall, createUpdate } from '../src/pwa/install';
import { base64UrlToBytes, createPush, type PushEnv, type SubscriptionLike } from '../src/pwa/push';
import { fakeEnv } from './fakePwa';
import { memoryStorage } from './fakeSocket';
import { openMore, renderApp } from './render';

afterEach(cleanup);

const KEY = 'BAEC'; // base64url of bytes 4, 1, 2
const ENDPOINT = 'https://push.example.com/dev1';

/** A fake browser: Notification permission plus a push manager with at most one subscription. */
function fakeBrowser(o: { permission?: NotificationPermission | null; answer?: NotificationPermission; ios?: boolean; standalone?: boolean; noSw?: boolean } = {}) {
  let permission: NotificationPermission | null = o.permission === undefined ? 'default' : o.permission;
  let current: SubscriptionLike | null = null;
  const make = (key: ArrayBuffer): SubscriptionLike => {
    const s: SubscriptionLike = {
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(async () => {
        if (current === s) current = null;
        return true;
      }),
      options: { applicationServerKey: key },
    };
    return s;
  };
  const pm = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (opts: { applicationServerKey: Uint8Array<ArrayBuffer> }) => (current = make(opts.applicationServerKey.slice().buffer))),
  };
  const requestPermission = vi.fn(async () => (permission = o.answer ?? 'granted'));
  const env: PushEnv = {
    ios: o.ios ?? false,
    standalone: o.standalone ?? false,
    permission: () => permission,
    requestPermission,
    pushManager: async () => (o.noSw ? null : pm),
  };
  return { env, pm, requestPermission, sub: () => current, setSub: (key: ArrayBuffer) => (current = make(key)), grant: () => (permission = 'granted') };
}

describe('push store', () => {
  it('decodes base64url keys', () => {
    expect([...base64UrlToBytes(KEY)]).toEqual([4, 1, 2]);
    expect([...base64UrlToBytes('-_8')]).toEqual([251, 255]);
  });

  it('reports iOS in Safari as needing the installed app, and no service worker as unsupported', async () => {
    const ios = createPush(fakeBrowser({ ios: true }).env);
    await ios.refresh();
    expect(ios.getState().status).toBe('install');
    const none = createPush(fakeBrowser({ noSw: true }).env);
    await none.refresh();
    expect(none.getState().status).toBe('unsupported');
    const noApi = createPush(fakeBrowser({ permission: null }).env);
    await noApi.refresh();
    expect(noApi.getState().status).toBe('unsupported');
  });

  it('starts off without asking; asks permission only in enable, then subscribes and saves', async () => {
    const b = fakeBrowser();
    const push = createPush(b.env);
    await push.refresh();
    expect(push.getState().status).toBe('off');
    expect(b.requestPermission).not.toHaveBeenCalled();
    const save = vi.fn();
    expect(await push.enable(KEY, save)).toBe(true);
    expect(b.requestPermission).toHaveBeenCalledOnce();
    expect([...b.pm.subscribe.mock.calls[0][0].applicationServerKey]).toEqual([4, 1, 2]);
    expect(save).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } });
    expect(push.getState()).toEqual({ status: 'on', busy: false });
  });

  it('stays off when permission is refused', async () => {
    const b = fakeBrowser({ answer: 'denied' });
    const push = createPush(b.env);
    const save = vi.fn();
    expect(await push.enable(KEY, save)).toBe(false);
    expect(push.getState().status).toBe('denied');
    expect(save).not.toHaveBeenCalled();
    expect(b.pm.subscribe).not.toHaveBeenCalled();
  });

  it('replaces a subscription made with another server key', async () => {
    const b = fakeBrowser();
    b.grant();
    b.setSub(new Uint8Array([9, 9, 9]).buffer);
    const old = b.sub()!;
    const push = createPush(b.env);
    await push.refresh();
    expect(push.getState().status).toBe('on');
    await push.enable(KEY, vi.fn());
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(b.pm.subscribe).toHaveBeenCalledOnce();
  });

  it('disable tells the server the endpoint and unsubscribes; sync resends it', async () => {
    const b = fakeBrowser();
    const push = createPush(b.env);
    await push.enable(KEY, vi.fn());
    const save = vi.fn();
    await push.sync(save);
    expect(save).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } });
    const remove = vi.fn();
    await push.disable(remove);
    expect(remove).toHaveBeenCalledWith(ENDPOINT);
    expect(b.sub()).toBeNull();
    expect(push.getState().status).toBe('off');
  });
});

describe('notifications switch', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36';
  function setup(b: ReturnType<typeof fakeBrowser>) {
    const win = fakeEnv({ userAgent: ANDROID });
    const push = createPush(b.env);
    const pwa = { install: createInstall(win, memoryStorage()), update: createUpdate(), online: createConnectivity(win), push };
    return { push, h: renderApp({ pwa }) };
  }
  const openAccount = (h: ReturnType<typeof renderApp>, key: string | null) => {
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'pushKey', key });
      h.sock().receive({ t: 'friends', list: { friends: [], incoming: [], outgoing: [] } });
    });
    openMore('Friends');
  };

  it('is hidden when the server has push off', async () => {
    const { push, h } = setup(fakeBrowser());
    await act(() => push.refresh());
    openAccount(h, null);
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).toBeNull();
  });

  it('asks permission on tap, sends the subscription, and turns off again', async () => {
    const b = fakeBrowser();
    const { push, h } = setup(b);
    await act(() => push.refresh());
    openAccount(h, KEY);
    expect(b.requestPermission).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    });
    expect(b.requestPermission).toHaveBeenCalledOnce();
    const sub = { endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } };
    expect(h.sock().sent).toContainEqual({ t: 'pushSubscribe', sub });
    expect(screen.getByText('Notifications are on for this device.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    });
    expect(h.sock().sent).toContainEqual({ t: 'pushUnsubscribe', endpoint: ENDPOINT });
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeTruthy();
  });

  it('explains that iPhone needs the Home Screen app', async () => {
    const { push, h } = setup(fakeBrowser({ ios: true }));
    await act(() => push.refresh());
    openAccount(h, KEY);
    expect(screen.getByText(/Add to Home Screen, open it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).toBeNull();
  });

  it('logging out stops this device getting the account notifications', async () => {
    const b = fakeBrowser();
    const { push, h } = setup(b);
    await act(() => push.enable(KEY, vi.fn()));
    openAccount(h, KEY);
    // Friends → (not logged out there); the Account screen holds Log out.
    cleanup();
    const again = setup(b);
    await act(() => again.push.refresh());
    act(() => {
      again.h.sock().receive({ t: 'account', username: 'Ana' });
      again.h.sock().receive({ t: 'pushKey', key: KEY });
    });
    openMore('Account settings');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    });
    const sent = again.h.sock().sent.map((m) => m.t);
    expect(sent).toContain('pushUnsubscribe');
    expect(sent.indexOf('pushUnsubscribe')).toBeLessThan(sent.indexOf('logout'));
    expect(push.getState().status).toBe('on'); // the first store was never told; the device itself is now unsubscribed
    expect(b.sub()).toBeNull();
  });
});
