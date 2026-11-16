/**
 * The "Enable notifications" switch: browser permission plus a Web Push subscription made with the
 * server's VAPID key. Browser APIs are injected so tests can drive it.
 */
import type { PushSub } from '@arcane/protocol';

/**
 * unsupported: no push in this browser (or no service worker, e.g. the dev server);
 * install: iPhone/iPad in Safari, where push works only from the Home Screen app;
 * denied: the user blocked notifications; off / on: this device is (not) subscribed.
 */
export type PushStatus = 'unsupported' | 'install' | 'denied' | 'off' | 'on';

export interface PushState {
  status: PushStatus;
  /** Asking permission or talking to the push service. */
  busy: boolean;
}

export interface SubscriptionLike {
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
  options?: { applicationServerKey?: ArrayBuffer | null };
}

export interface PushManagerLike {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(opts: { userVisibleOnly: true; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<SubscriptionLike>;
}

export interface PushEnv {
  ios: boolean;
  standalone: boolean;
  /** Notification.permission, or null when the browser has no Notification API. */
  permission(): NotificationPermission | null;
  requestPermission(): Promise<NotificationPermission>;
  /** The service worker's push manager, or null when there is none. */
  pushManager(): Promise<PushManagerLike | null>;
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameKey(buf: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

function toSub(s: SubscriptionLike): PushSub | null {
  const j = s.toJSON();
  return j.endpoint && j.keys?.p256dh && j.keys.auth ? { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } : null;
}

export function createPush(env: PushEnv) {
  let state: PushState = { status: 'unsupported', busy: false };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PushState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const manager = async () => (env.permission() === null ? null : env.pushManager().catch(() => null));

  /** Read the current permission and subscription. */
  async function refresh(): Promise<void> {
    if (env.ios && !env.standalone) return set({ status: 'install' });
    const pm = await manager();
    if (!pm) return set({ status: 'unsupported' });
    if (env.permission() === 'denied') return set({ status: 'denied' });
    const sub = env.permission() === 'granted' ? await pm.getSubscription().catch(() => null) : null;
    set({ status: sub ? 'on' : 'off' });
  }

  return {
    getState: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    refresh,
    /** Ask permission (only call from a tap) and subscribe with the server's key. True when it worked. */
    async enable(key: string, save: (sub: PushSub) => void): Promise<boolean> {
      if (state.busy) return false;
      set({ busy: true });
      try {
        const pm = await manager();
        if (!pm) {
          set({ status: 'unsupported' });
          return false;
        }
        const permission = await env.requestPermission();
        if (permission !== 'granted') {
          set({ status: permission === 'denied' ? 'denied' : 'off' });
          return false;
        }
        const appKey = base64UrlToBytes(key);
        let sub = await pm.getSubscription();
        // A subscription made with an older server key cannot be used: replace it.
        if (sub && !sameKey(sub.options?.applicationServerKey, appKey)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await pm.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
        const json = toSub(sub);
        if (!json) throw new Error('subscription without keys');
        save(json);
        set({ status: 'on' });
        return true;
      } catch (e) {
        console.error('could not turn on notifications:', (e as Error).message);
        set({ status: 'off' });
        return false;
      } finally {
        set({ busy: false });
      }
    },
    /** Unsubscribe this device and tell the server to forget it. */
    async disable(remove: (endpoint: string) => void): Promise<void> {
      set({ busy: true });
      try {
        const sub = await (await manager())?.getSubscription();
        const endpoint = sub ? toSub(sub)?.endpoint : undefined;
        if (endpoint) remove(endpoint);
        await sub?.unsubscribe();
      } catch (e) {
        console.error('could not turn off notifications:', (e as Error).message);
      } finally {
        set({ status: state.status === 'on' ? 'off' : state.status, busy: false });
      }
    },
    /** Resend this device's subscription (after login), so the server links it to the current account. */
    async sync(save: (sub: PushSub) => void): Promise<void> {
      if (env.permission() !== 'granted') return;
      const sub = await (await manager())?.getSubscription().catch(() => null);
      const json = sub ? toSub(sub) : null;
      if (json) save(json);
    },
  };
}

export type PushStore = ReturnType<typeof createPush>;
