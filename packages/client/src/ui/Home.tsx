import { useState } from 'react';
import { ACADEMIES, type BotLevel } from '@arcane/engine';
import { MAX_NAME } from '@arcane/protocol';
import { useClient, usePrefs, useT } from './context';
import { Crest } from './Icon';

export const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

export function Home(props: { initialRoom?: string; onRules(): void; onSettings(): void }) {
  const client = useClient();
  const t = useT();
  const [prefs, setPrefs] = usePrefs();
  const [name, setName] = useState(prefs.name);
  const [code, setCode] = useState((props.initialRoom ?? '').toUpperCase());
  const [bots, setBots] = useState(3);
  const [level, setLevel] = useState<BotLevel>('normal');

  const trimmed = name.trim();
  const nameOk = trimmed.length > 0 && trimmed.length <= MAX_NAME;
  const remember = () => {
    if (prefs.name !== trimmed) setPrefs({ ...prefs, name: trimmed });
  };

  return (
    <main className="screen home">
      <header className="hero">
        <h1>{t('appName')}</h1>
        <p>{t('tagline')}</p>
        <div className="crest-arc" aria-hidden="true">
          {ACADEMIES.map((a) => (
            <Crest key={a.id} academyId={a.id} size={38} />
          ))}
        </div>
      </header>

      <label className="field">
        <span>{t('yourName')}</span>
        <input aria-label={t('yourName')} value={name} maxLength={MAX_NAME} autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
      </label>

      <section className="panel">
        <button
          className="primary"
          disabled={!nameOk}
          onClick={() => {
            remember();
            client.create(trimmed);
          }}
        >
          {t('createGame')}
        </button>
      </section>

      <section className="panel row">
        <input
          aria-label={t('roomCode')}
          placeholder={t('roomCode')}
          value={code}
          maxLength={16}
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          disabled={!nameOk || code.trim().length === 0}
          onClick={() => {
            remember();
            client.join(code.trim(), trimmed);
          }}
        >
          {t('join')}
        </button>
      </section>

      <section className="panel">
        <div className="row">
          <label className="field small">
            <span>{t('bots')}</span>
            <select aria-label={t('bots')} value={bots} onChange={(e) => setBots(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field small">
            <span>{t('level')}</span>
            <select aria-label={t('level')} value={level} onChange={(e) => setLevel(e.target.value as BotLevel)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`level_${l}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          disabled={!nameOk}
          onClick={() => {
            remember();
            client.solo(trimmed, bots, level);
          }}
        >
          {t('playSolo')}
        </button>
      </section>

      <nav className="row links">
        <button className="link" onClick={props.onRules}>
          {t('rules')}
        </button>
        <button className="link" onClick={props.onSettings}>
          {t('settings')}
        </button>
      </nav>
    </main>
  );
}
