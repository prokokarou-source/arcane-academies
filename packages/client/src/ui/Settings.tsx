import { MAX_NAME } from '@arcane/protocol';
import type { Lang } from '../i18n/strings';
import { usePrefs, useT } from './context';
import type { Prefs } from './prefs';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'el', label: 'Ελληνικά' },
];

export function Settings({ onBack }: { onBack(): void }) {
  const t = useT();
  const [prefs, setPrefs] = usePrefs();
  const toggle = (k: 'animations' | 'music' | 'sfx' | 'haptics') => (
    <label className="field check">
      <input type="checkbox" aria-label={t(k)} checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked } as Prefs)} />
      <span>{t(k)}</span>
    </label>
  );
  return (
    <main className="screen">
      <h2>{t('settings')}</h2>
      <label className="field">
        <span>{t('yourName')}</span>
        <input aria-label={t('yourName')} value={prefs.name} maxLength={MAX_NAME} onChange={(e) => setPrefs({ ...prefs, name: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('language')}</span>
        <select aria-label={t('language')} value={prefs.lang} onChange={(e) => setPrefs({ ...prefs, lang: e.target.value as Lang })}>
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      {toggle('animations')}
      {toggle('music')}
      {toggle('sfx')}
      {toggle('haptics')}
      <button onClick={onBack}>{t('back')}</button>
    </main>
  );
}
