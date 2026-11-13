import { useEffect, useState } from 'react';
import { useSound } from '../audio/context';
import { useT } from './context';

const TICK_FROM = 5;

/** Seconds left until the server's turn deadline (server epoch ms). */
export function Deadline({ deadline }: { deadline: number }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
  const sound = useSound();
  // A soft tick in the last seconds of the turn.
  useEffect(() => {
    if (secs > 0 && secs <= TICK_FROM) sound('tick');
  }, [secs, sound]);
  return <span className={`deadline${secs <= 10 ? ' urgent' : ''}`}>{t('timeLeft', { n: secs })}</span>;
}
