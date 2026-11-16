import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ConnectivityStore, InstallState, InstallStore, UpdateStore } from './install';
import type { PushState, PushStore } from './push';

export interface Pwa {
  install: InstallStore;
  update: UpdateStore;
  online: ConnectivityStore;
  /** Notifications; absent where the app has no service worker (dev server, tests). */
  push?: PushStore;
}

const PwaContext = createContext<Pwa | null>(null);

export function PwaProvider(props: { pwa: Pwa; children: ReactNode }) {
  return <PwaContext.Provider value={props.pwa}>{props.children}</PwaContext.Provider>;
}

const noop = () => () => {};
const NO_INSTALL: InstallState = { canInstall: false, iosHint: false };

/** Install offer for Home; without a provider nothing is offered. */
export function useInstall(): InstallState & { install(): void; dismissIosHint(): void } {
  const pwa = useContext(PwaContext);
  const state = useSyncExternalStore(pwa?.install.subscribe ?? noop, pwa?.install.getState ?? (() => NO_INSTALL));
  return {
    ...state,
    install: () => void pwa?.install.install(),
    dismissIosHint: () => pwa?.install.dismissIosHint(),
  };
}

export function useUpdate(): { ready: boolean; apply(): void } {
  const pwa = useContext(PwaContext);
  const ready = useSyncExternalStore(pwa?.update.subscribe ?? noop, pwa?.update.getState ?? (() => false));
  return { ready, apply: () => pwa?.update.apply() };
}

export function useOnline(): boolean {
  const pwa = useContext(PwaContext);
  return useSyncExternalStore(pwa?.online.subscribe ?? noop, pwa?.online.getState ?? (() => true));
}

const NO_PUSH: PushState = { status: 'unsupported', busy: false };

/** Notification switch state; 'unsupported' without a push store. */
export function usePush(): PushState & { store: PushStore | null } {
  const pwa = useContext(PwaContext);
  const state = useSyncExternalStore(pwa?.push?.subscribe ?? noop, pwa?.push?.getState ?? (() => NO_PUSH));
  return { ...state, store: pwa?.push ?? null };
}
