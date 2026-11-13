import type { ScoreBreakdown } from '@arcane/engine';
import type { GameResult, SeatStatus } from '@arcane/protocol';
import { useClient, useClientState, useT } from './context';

const CATS = ['duels', 'coins', 'tower', 'lore', 'trade', 'research', 'patrons', 'total'] as const satisfies readonly (keyof ScoreBreakdown)[];

export function GameEnd(props: { me: number; result: GameResult; seats: SeatStatus[] }) {
  const client = useClient();
  const t = useT();
  const { seatId, hostId } = useClientState();
  const { result, seats, me } = props;
  const name = (seat: number) => seats[seat]?.name ?? `#${seat}`;
  const winners = result.winners.map(name).join(', ');
  const isHost = seatId !== null && seatId === hostId;
  // The server lets anyone start the rematch when the host is gone; the client can't tell which seat is the host,
  // so it offers the button whenever another human is offline.
  const hostMaybeGone = seats.some((s) => s.kind === 'human' && !s.connected && s.seat !== me);
  const ranked = [...result.scores].sort((a, b) => b.total - a.total);
  return (
    <section className="panel game-end">
      <h2 className="center">{t('gameOver')}</h2>
      <p className="winner">{result.winners.length > 1 ? t('winnersAre', { names: winners }) : t('winnerIs', { names: winners })}</p>
      <div className="scores-wrap">
        <table className="scores">
          <thead>
            <tr>
              <th />
              {CATS.map((c) => (
                <th key={c} scope="col">
                  {t(`cat_${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => (
              <tr key={s.seat} className={s.seat === me ? 'mine' : ''}>
                <td>
                  {name(s.seat)}
                  {seats[s.seat]?.kind === 'archmage' && <span className="muted small">{` (${t('cantWin')})`}</span>}
                </td>
                {CATS.map((c) => (
                  <td key={c}>{s[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isHost || hostMaybeGone ? (
        <button className="primary" onClick={() => client.rematch()}>
          {t('rematch')}
        </button>
      ) : (
        <p className="muted center">{t('waitingRematch')}</p>
      )}
      <button className="link" onClick={() => client.leave()}>
        {t('leave')}
      </button>
    </section>
  );
}
