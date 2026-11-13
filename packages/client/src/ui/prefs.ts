import type { Lang } from '../i18n/strings';

export interface Prefs {
  name: string;
  lang: Lang;
  animations: boolean;
  music: boolean;
  sfx: boolean;
  haptics: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'arcane.prefs';
export const DEFAULT_PREFS: Prefs = { name: '', lang: 'en', animations: true, music: true, sfx: true, haptics: true };

export function loadPrefs(storage: Store): Prefs {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? '{}') as Partial<Prefs> & { sound?: boolean };
    // Older versions had one Sound switch; turning it off silenced everything.
    const soundOn = v.sound !== false;
    return {
      name: typeof v.name === 'string' ? v.name : DEFAULT_PREFS.name,
      lang: v.lang === 'el' ? 'el' : 'en',
      animations: v.animations !== false,
      music: typeof v.music === 'boolean' ? v.music : soundOn,
      sfx: typeof v.sfx === 'boolean' ? v.sfx : soundOn,
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
