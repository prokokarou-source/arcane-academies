import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { translate, type StringKey } from '../i18n/strings';
import type { ClientState, GameClient } from '../net/client';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

interface Ctx {
  client: GameClient;
  prefs: Prefs;
  setPrefs(p: Prefs): void;
}

const ClientContext = createContext<Ctx | null>(null);

export function ClientProvider(props: { client: GameClient; storage: Pick<Storage, 'getItem' | 'setItem'>; children: ReactNode }) {
  const { client, storage } = props;
  const [prefs, setState] = useState(() => loadPrefs(storage));
  const setPrefs = useCallback(
    (p: Prefs) => {
      savePrefs(storage, p);
      setState(p);
    },
    [storage],
  );
  return <ClientContext.Provider value={{ client, prefs, setPrefs }}>{props.children}</ClientContext.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(ClientContext);
  if (!c) throw new Error('ClientProvider missing');
  return c;
}

export const useClient = (): GameClient => useCtx().client;

export function useClientState(): ClientState {
  const client = useClient();
  return useSyncExternalStore(client.subscribe, client.getState);
}

export function usePrefs(): [Prefs, (p: Prefs) => void] {
  const c = useCtx();
  return [c.prefs, c.setPrefs];
}

export type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function useT(): T {
  const lang = useCtx().prefs.lang;
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}
