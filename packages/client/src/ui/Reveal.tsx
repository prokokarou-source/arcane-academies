import { useEffect, type CSSProperties } from 'react';
import { ACADEMIES } from '@arcane/engine';
import { useClient, useClientState, usePrefs, useT } from './context';
import { Crest } from './Icon';

/** How long the draw stays before the first turn (it can be tapped away sooner). */
export const REVEAL_MS = 5500;

/** Timeline of the draw, in seconds (the CSS animations read these through `--d`). */
const COIN_AT = 0.3; // the coin starts spinning (it lands 1.5 s later)
const CARDS_AT = 2.8; // the coin has moved under the title; cards start dealing
const LAST_CARD_BY = 4.2; // the player's own card starts dealing no later than this
const MAX_STEP = 0.3; // gap between two cards when there are only a few

/** When each card starts dealing: the others first, the player's own card last. */
export function dealDelays(cards: number): number[] {
  if (cards <= 1) return [CARDS_AT];
  const step = Math.min(MAX_STEP, (LAST_CARD_BY - CARDS_AT) / (cards - 1));
  return Array.from({ length: cards }, (_, i) => +(CARDS_AT + i * step).toFixed(2));
}

const delay = (s: number) => ({ ['--d' as string]: `${s}s` }) as CSSProperties;

/**
 * The start-of-game draw: a coin picks the side for the whole table, then each seat's academy card
 * is dealt and turned over, the player's own last. Tap anywhere to skip; with Animations off it is skipped entirely.
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
  const cards = [...reveal.academies.filter((a) => a.seat !== me), ...reveal.academies.filter((a) => a.seat === me)];
  const at = dealDelays(cards.length);
  const tapAt = at[at.length - 1] + 0.5;
  // The coin lands on face A after four full turns, on face B after four and a half.
  const coinStyle = { ...delay(COIN_AT), ['--land' as string]: reveal.side === 'B' ? '1620deg' : '1440deg' } as CSSProperties;

  return (
    <div className="reveal" role="dialog" aria-label={t('theDraw')} onClick={() => client.clearReveal()}>
      <h2 className="reveal-title">{t('theDraw')}</h2>
      <div className="reveal-side" style={delay(CARDS_AT - 0.55)}>
        <div className="coin-lift" style={delay(COIN_AT)}>
          <div className="coin" data-side={reveal.side} style={coinStyle} aria-hidden="true">
            <span className="coin-face a">A</span>
            <span className="coin-face b">B</span>
          </div>
          <span className="coin-ring" style={delay(COIN_AT + 1.5)} aria-hidden="true" />
        </div>
        <p className="reveal-caption" style={delay(COIN_AT + 1.6)}>
          {t('sideForAll', { side: reveal.side })}
        </p>
      </div>
      <ul className="reveal-cards">
        {cards.map((a, i) => {
          const mine = a.seat === me;
          return (
            <li key={a.seat} className={`reveal-card${mine ? ' mine' : ''}`} style={delay(at[i])}>
              <div className="reveal-card-inner" style={delay(at[i] + 0.3)}>
                <div className="reveal-card-front">
                  <Crest academyId={a.academyId} size={mine ? 44 : 32} />
                  <span className="name">{mine ? t('you') : nameOf(a.seat)}</span>
                  <strong>{ACADEMIES.find((x) => x.id === a.academyId)?.name ?? a.academyId}</strong>
                </div>
                <div className="reveal-card-back" aria-hidden="true">
                  ✦
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="reveal-tap" style={delay(tapAt)}>
        {t('tapToBegin')}
      </p>
    </div>
  );
}
