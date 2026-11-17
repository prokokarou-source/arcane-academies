import { useEffect } from 'react';
import { ACADEMIES } from '@arcane/engine';
import { useClient, useClientState, usePrefs, useT } from './context';
import { Crest } from './Icon';

/** How long the draw stays before the first turn (it can be tapped away sooner). */
export const REVEAL_MS = 4200;

/**
 * The start-of-game draw: one side for the table, then each seat's academy, one after another.
 * With Animations off it is skipped entirely.
 */
export function Reveal() {
  const client = useClient();
  const t = useT();
  const [prefs] = usePrefs();
  const { reveal, game } = useClientState();
  useEffect(() => {
    if (!reveal) return;
    if (!prefs.animations) return client.clearReveal();
    const id = setTimeout(() => client.clearReveal(), REVEAL_MS);
    return () => clearTimeout(id);
  }, [reveal, prefs.animations, client]);
  if (!reveal || !game || !prefs.animations) return null;

  const me = game.view.me;
  const nameOf = (seat: number) => game.seats.find((s) => s.seat === seat)?.name ?? '';
  return (
    <div className="reveal" role="dialog" aria-label={t('theDraw')} onClick={() => client.clearReveal()}>
      <h2>{t('theDraw')}</h2>
      <div className="reveal-side">
        <span className="coin">{reveal.side}</span>
        <span>{t('sideForAll', { side: reveal.side })}</span>
      </div>
      <ul className="reveal-list">
        {reveal.academies.map((a, i) => (
          <li key={a.seat} className={a.seat === me ? 'mine' : ''} style={{ animationDelay: `${0.9 + i * 0.25}s` }}>
            <Crest academyId={a.academyId} size={30} />
            <span className="name">{a.seat === me ? t('you') : nameOf(a.seat)}</span>
            <strong>{ACADEMIES.find((x) => x.id === a.academyId)?.name ?? a.academyId}</strong>
          </li>
        ))}
      </ul>
      <p className="muted small">{t('tapToBegin')}</p>
    </div>
  );
}
