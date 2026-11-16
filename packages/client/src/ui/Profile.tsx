import { useEffect } from 'react';
import { ACADEMIES } from '@arcane/engine';
import { useClient, useClientState, useT } from './context';

const academyName = (id: string) => ACADEMIES.find((a) => a.id === id)?.name ?? id;

/** My totals and the last games played while logged in. */
export function Profile(props: { onBack(): void }) {
  const client = useClient();
  const t = useT();
  const { profile, account } = useClientState();
  useEffect(() => client.requestProfile(), [client]);
  const p = profile?.username === account ? profile : null;

  return (
    <main className="screen">
      <h2>{t('profile')}</h2>
      <p className="muted small">{t('signedInAs', { name: account ?? '' })}</p>
      {!p ? (
        <p className="status">{t('loadingStats')}</p>
      ) : (
        <>
          <dl className="stats panel" aria-label={t('profile')}>
            <dt>{t('statGames')}</dt>
            <dd>{p.games}</dd>
            <dt>{t('statWins')}</dt>
            <dd>{p.wins}</dd>
            <dt>{t('statWinRate')}</dt>
            <dd>{p.games ? `${Math.round((100 * p.wins) / p.games)}%` : '–'}</dd>
            <dt>{t('statAvgScore')}</dt>
            <dd>{p.games ? (p.totalScore / p.games).toFixed(1) : '–'}</dd>
            <dt>{t('statBest')}</dt>
            <dd>{p.games ? p.bestScore : '–'}</dd>
          </dl>
          <h3>{t('recentGames')}</h3>
          <ul className="seats" aria-label={t('recentGames')}>
            {p.recent.length === 0 && <li className="muted small">{t('noGames')}</li>}
            {p.recent.map((g, i) => (
              <li key={`${g.at}-${i}`} className="seat">
                <div className="seat-top">
                  <span className="muted small">{new Date(g.at).toLocaleDateString()}</span>
                  <span className="name">{academyName(g.academyId)}</span>
                  {g.won && <span className="tag">{t('winTag')}</span>}
                  <span className="small">{t('placeOf', { place: g.place, players: g.players })}</span>
                  <span className="muted small">{t('points', { n: g.score })}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="link" onClick={props.onBack}>
        {t('back')}
      </button>
    </main>
  );
}
