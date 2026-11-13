import type { Lang } from '../i18n/strings';

export interface Prefs {
  name: string;
  lang: Lang;
  animations: boolean;
  sound: boolean;
  haptics: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'arcane.prefs';
export const DEFAULT_PREFS: Prefs = { name: '', lang: 'en', animations: true, sound: true, haptics: true };

export function loadPrefs(storage: Store): Prefs {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      name: typeof v.name === 'string' ? v.name : DEFAULT_PREFS.name,
      lang: v.lang === 'el' ? 'el' : 'en',
      animations: v.animations !== false,
      sound: v.sound !== false,
      haptics: v.haptics !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(storage: Store, p: Prefs): void {
  try {
    storage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore: preferences are a convenience
  }
}
