import { Fragment, useState } from 'react';
import { cardDef, type ScoreBreakdown, type ScoreCategory, type ScoreItem } from '@arcane/engine';
import type { GameResult, SeatStatus } from '@arcane/protocol';
import { useClient, useClientState, useT, type T } from './context';
import { FAMILY_COLOR } from './Family';

const CATS = ['duels', 'coins', 'tower', 'lore', 'trade', 'research', 'patrons', 'total'] as const satisfies readonly (keyof ScoreBreakdown)[];
const ITEM_ORDER: ScoreCategory[] = ['duels', 'coins', 'tower', 'lore', 'trade', 'patrons', 'research'];
const CAT_COLOR: Record<ScoreCategory, string> = {
  duels: FAMILY_COLOR.duel,
  coins: 'var(--gold)',
  tower: 'var(--muted)',
  lore: FAMILY_COLOR.lore,
  trade: FAMILY_COLOR.trade,
  research: FAMILY_COLOR.research,
  patrons: FAMILY_COLOR.patron,
};

function itemLabel(t: T, item: ScoreItem): string {
  switch (item.kind) {
    case 'card':
      return cardDef(item.defId).name;
    case 'stage':
      return t('src_stage', { n: item.stage });
    case 'power':
      return t('src_power');
    case 'coins':
      return t('src_coins', { n: item.n });
    case 'duels':
      return t('src_duels');
    case 'research':
      return t('src_research');
  }
}

function ScoreItems(props: { items: ScoreItem[] | undefined }) {
  const t = useT();
  // A server from before this change sends no items; show nothing rather than crash.
  const items = [...(props.items ?? [])].sort((a, b) => ITEM_ORDER.indexOf(a.cat) - ITEM_ORDER.indexOf(b.cat) || b.points - a.points);
  if (items.length === 0) return <p className="muted small">{t('noPoints')}</p>;
  return (
    <ul className="score-items">
      {items.map((item, i) => (
        <li key={i}>
          <span className="dot" style={{ background: CAT_COLOR[item.cat] }} aria-hidden="true" />
          <span className="score-item-name">{itemLabel(t, item)}</span>
          <span className="muted small">{t(`cat_${item.cat}`)}</span>
          <span className={`score-item-pts${item.points < 0 ? ' loss' : ''}`}>{item.points > 0 ? `+${item.points}` : item.points}</span>
        </li>
      ))}
    </ul>
  );
}

export function GameEnd(props: { me: number; result: GameResult; seats: SeatStatus[] }) {
  const client = useClient();
  const t = useT();
  const { seatId, hostId } = useClientState();
  const { result, seats, me } = props;
  const [open, setOpen] = useState<number | null>(me);
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
            {ranked.map((s) => {
              const isOpen = open === s.seat;
              return (
                <Fragment key={s.seat}>
                  <tr className={`${s.seat === me ? 'mine' : ''}${isOpen ? ' open' : ''}`}>
                    <td>
                      <button
                        type="button"
                        className="score-who"
                        aria-expanded={isOpen}
                        aria-label={t('showDetails', { name: name(s.seat) })}
                        onClick={() => setOpen(isOpen ? null : s.seat)}
                      >
                        <span className="caret" aria-hidden="true">
                          {isOpen ? '▾' : '▸'}
                        </span>
                        {name(s.seat)}
                      </button>
                      {seats[s.seat]?.kind === 'archmage' && <span className="muted small">{` (${t('cantWin')})`}</span>}
                    </td>
                    {CATS.map((c) => (
                      <td key={c}>{s[c]}</td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="score-detail">
                      <td colSpan={CATS.length + 1}>
                        <ScoreItems items={s.items} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small center">{t('tapForDetails')}</p>
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
