import type { PlayerView } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';
import { duelPowerOf, neighbors } from '../game/derive';
import { usePrefs, useT } from './context';
import { DUEL } from './icons';

export const ROMAN = ['I', 'II', 'III'];

/** My duels of the Term that just ended. Ties add no token, so results come from duel power; amounts from the tokens. */
export function TermEnd(props: { term: number; view: PlayerView; deltas: number[]; seats: SeatStatus[]; onClose(): void }) {
  const t = useT();
  const [prefs] = usePrefs();
  const { view } = props;
  const { left, right } = neighbors(view);
  const mine = duelPowerOf(view.players[view.me]);
  const wins = props.deltas.filter((d) => d > 0);
  const rows = [...new Set([left, right])].map((seat) => {
    const theirs = duelPowerOf(view.players[seat]);
    const outcome = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'tie';
    const amount = outcome === 'win' ? (wins.shift() ?? 0) : outcome === 'loss' ? -1 : 0;
    return { seat, theirs, outcome, amount };
  });
  const name = (seat: number) => props.seats[seat]?.name ?? view.players[seat].config.name;
  return (
    <div className="sheet-backdrop">
      <section className={`sheet${prefs.animations ? ' pop' : ''}`} role="dialog" aria-label={t('duelsTitle', { n: ROMAN[props.term - 1] })}>
        <h3>{t('duelsTitle', { n: ROMAN[props.term - 1] })}</h3>
        <p className="muted small">{`${t('duelPower')}: ${DUEL} ${mine}`}</p>
        <ul className="duels">
          {rows.map((r) => (
            <li key={r.seat}>
              <span>{t('vs', { name: name(r.seat) })}</span>
              <span className="muted small">{`${DUEL} ${r.theirs}`}</span>
              <span className={r.outcome}>
                {r.outcome === 'tie' ? t('tie') : `${t(r.outcome as 'win' | 'loss')} ${r.amount > 0 ? '+' : ''}${r.amount}`}
              </span>
            </li>
          ))}
        </ul>
        <button className="primary" onClick={props.onClose}>
          {t('continue')}
        </button>
      </section>
    </div>
  );
}
