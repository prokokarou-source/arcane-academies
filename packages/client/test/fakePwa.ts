import { vi } from 'vitest';
import type { InstallEnv } from '../src/pwa/install';

/** A window-like object for the install logic: events, display-mode media query and navigator fields. */
export function fakeEnv(o: { userAgent: string; standaloneMedia?: boolean; navigatorStandalone?: boolean; onLine?: boolean; maxTouchPoints?: number }) {
  const target = new EventTarget();
  const env = Object.assign(target, {
    matchMedia: (q: string) => ({ matches: q.includes('standalone') && o.standaloneMedia === true }),
    navigator: {
      userAgent: o.userAgent,
      maxTouchPoints: o.maxTouchPoints ?? 0,
      standalone: o.navigatorStandalone,
      onLine: o.onLine ?? true,
    },
  });
  return env satisfies InstallEnv;
}

/** A beforeinstallprompt event whose prompt resolves with the given choice. */
export function installPrompt(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  return Object.assign(e, {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
}
