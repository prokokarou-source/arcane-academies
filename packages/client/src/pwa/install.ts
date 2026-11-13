/**
 * Small stores for running as an installed app: the install offer (Android prompt, iOS hint),
 * a waiting update, and whether the device is online. Each has getState/subscribe for useSyncExternalStore.
 */

export interface InstallEnv {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
  matchMedia?(query: string): { matches: boolean };
  navigator: { userAgent: string; maxTouchPoints?: number; standalone?: boolean; onLine?: boolean };
}

/** The non-standard event Chromium fires when the app may be installed. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Android/desktop Chromium: the browser lets us show its install dialog. */
  canInstall: boolean;
  /** iOS: show "Share → Add to Home Screen" once. */
  iosHint: boolean;
}

const IOS_HINT_KEY = 'arcane.iosHintSeen';

/** iPhone, iPod, or an iPad (which reports itself as a Mac but has a touch screen). */
export function isIos(nav: { userAgent: string; maxTouchPoints?: number }): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
}

export function isStandalone(env: InstallEnv): boolean {
  return env.matchMedia?.('(display-mode: standalone)').matches === true || env.navigator.standalone === true;
}

function store<S>(initial: S) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    set(next: S) {
      state = next;
      listeners.forEach((fn) => fn());
    },
  };
}

export function createInstall(env: InstallEnv, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const standalone = isStandalone(env);
  let seen = false;
  try {
    seen = storage.getItem(IOS_HINT_KEY) === '1';
  } catch {
    // storage blocked: show the hint
  }
  const s = store<InstallState>({ canInstall: false, iosHint: !standalone && isIos(env.navigator) && !seen });
  let deferred: InstallPromptEvent | null = null;

  const onPrompt = (e: Event) => {
    e.preventDefault();
    if (standalone) return;
    deferred = e as InstallPromptEvent;
    s.set({ ...s.getState(), canInstall: true });
  };
  const onInstalled = () => {
    deferred = null;
    s.set({ canInstall: false, iosHint: false });
  };
  env.addEventListener('beforeinstallprompt', onPrompt);
  env.addEventListener('appinstalled', onInstalled);

  return {
    getState: s.getState,
    subscribe: s.subscribe,
    /** Shows the browser's install dialog. The prompt can be used only once. */
    async install(): Promise<void> {
      const e = deferred;
      if (!e) return;
      deferred = null;
      s.set({ ...s.getState(), canInstall: false });
      await e.prompt();
      await e.userChoice;
    },
    dismissIosHint() {
      try {
        storage.setItem(IOS_HINT_KEY, '1');
      } catch {
        // storage blocked: hide it for this visit only
      }
      s.set({ ...s.getState(), iosHint: false });
    },
    dispose() {
      env.removeEventListener('beforeinstallprompt', onPrompt);
      env.removeEventListener('appinstalled', onInstalled);
    },
  };
}

/** A new version waiting to take over; `ready` is called by the service worker registration. */
export function createUpdate() {
  const s = store(false);
  let reload = () => {};
  return {
    getState: s.getState,
    subscribe: s.subscribe,
    ready(fn: () => void) {
      reload = fn;
      s.set(true);
    },
    apply: () => reload(),
  };
}

export function createConnectivity(env: InstallEnv) {
  const s = store(env.navigator.onLine !== false);
  const update = () => s.set(env.navigator.onLine !== false);
  env.addEventListener('online', update);
  env.addEventListener('offline', update);
  return { getState: s.getState, subscribe: s.subscribe };
}

export type InstallStore = ReturnType<typeof createInstall>;
export type UpdateStore = ReturnType<typeof createUpdate>;
export type ConnectivityStore = ReturnType<typeof createConnectivity>;
