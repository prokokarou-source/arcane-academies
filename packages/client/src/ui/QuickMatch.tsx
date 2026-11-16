import { useEffect, useState } from 'react';
import { useSound } from '../audio/context';
import { useClient, useClientState, useT } from './context';

/** After this long with no match, offer to play against bots. */
export const ALONE_MS = 60_000;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Waiting for a quick match: elapsed time, who else is searching, cancel. */
export function QuickMatch() {
  const client = useClient();
  const { quick } = useClientState();
  const t = useT();
  const sound = useSound();
  const [now, setNow] = useState(() => Date.now());
  const [keepWaiting, setKeepWaiting] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!quick) return null;
  const waited = now - quick.since;

  return (
    <main className="screen center quick">
      <h2>{t('quickMatch')}</h2>
      <p className="status" role="status">
        {t('quickSearching')}
      </p>
      <p className="quick-time">{t('quickWaited', { time: clock(waited) })}</p>
      {quick.searching > 0 && <p className="muted">{t('quickCount', { n: quick.searching })}</p>}
      {waited >= ALONE_MS && !keepWaiting && (
        <section className="panel">
          <p className="muted">{t('quickAlone')}</p>
          <button className="primary" onClick={() => (sound('tap'), client.quickBots())}>
            {t('quickBots')}
          </button>
          <button onClick={() => setKeepWaiting(true)}>{t('quickKeep')}</button>
        </section>
      )}
      <button className="link" onClick={() => (sound('tap'), client.quickCancel())}>
        {t('cancel')}
      </button>
    </main>
  );
}
