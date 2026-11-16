import webpush from 'web-push';
import type { PushSub } from '@arcane/protocol';
import type { Store } from './store';

/** What the service worker shows. `url` is a same-origin path opened on tap. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
}

/** Delivers one encrypted message. Rejects with `{ statusCode }` when the push service refuses it. */
export type PushSender = (sub: PushSub, payload: string) => Promise<void>;

export interface PushConfig {
  publicKey: string;
  send: PushSender;
}

/** Push services answer these when a subscription is gone for good. */
const GONE = new Set([404, 410]);

/**
 * Web Push to a user's devices. Without a config (no VAPID keys) it is off: nothing is sent and
 * `publicKey` is null, so clients hide the option.
 */
export class Push {
  readonly publicKey: string | null;

  constructor(
    private readonly store: Store,
    private readonly config: PushConfig | null,
  ) {
    this.publicKey = config?.publicKey ?? null;
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  /** Send to every device of `userId`. Returns how many deliveries the push services accepted. */
  async notify(userId: string, payload: PushPayload): Promise<number> {
    if (!this.config) return 0;
    const { send } = this.config;
    const body = JSON.stringify(payload);
    const subs = await this.store.pushSubs(userId);
    const sent = await Promise.all(
      subs.map(async (sub) => {
        try {
          await send(sub, body);
          return 1;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status !== undefined && GONE.has(status)) await this.store.removePushSub(sub.endpoint).catch(() => {});
          else console.error('push failed:', status ?? (e as Error).message);
          return 0;
        }
      }),
    );
    return sent.reduce<number>((a, b) => a + b, 0);
  }
}

/** A push service endpoint the server may post to: https on a host name (not an IP or localhost). */
export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  const host = u.hostname;
  return u.protocol === 'https:' && host.includes('.') && !/^[\d.]+$/.test(host) && !host.startsWith('[') && host !== 'localhost';
}

/** Push config from VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT; null (push off) when any is missing or invalid. */
export function pushFromEnv(env: Record<string, string | undefined>): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  const vapidDetails = { subject, publicKey, privateKey };
  try {
    // Validates the keys and subject (mailto: or https:) once, at start.
    webpush.getVapidHeaders('https://push.example.com', subject, publicKey, privateKey, 'aes128gcm');
  } catch (e) {
    console.error('push notifications off, bad VAPID settings:', (e as Error).message);
    return null;
  }
  return {
    publicKey,
    send: async (sub, payload) => {
      await webpush.sendNotification(sub, payload, { vapidDetails, TTL: 60 * 60, urgency: 'high' });
    },
  };
}
