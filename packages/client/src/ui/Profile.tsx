import { useEffect } from 'react';
import { ACADEMIES } from '@arcane/engine';
import { useClient, useClientState, useT } from './context';
import { ScreenHead } from './ScreenHead';
import { AvatarGlyph } from './Avatar';

const academyName = (id: string) => ACADEMIES.find((a) => a.id === id)?.name ?? id;

/** My totals and the last games played while logged in. */
export function Profile(props: { onBack(): void }) {
  const client = useClient();
  const t = useT();
  const { profile, account, avatar } = useClientState();
  useEffect(() => client.requestProfile(), [client]);
  const p = profile?.username === account ? profile : null;

  return (
    <main className="screen">
      <ScreenHead title={t('profile')} onBack={props.onBack} />
      <p className="muted small profile-who">
        <AvatarGlyph avatar={avatar} size={32} />
        {t('signedInAs', { name: account ?? '' })}
      </p>
      {!p ? (
        <p className="status loading">{t('loadingStats')}</p>
      ) : (
        <>
          <dl className="stat-tiles" aria-label={t('profile')}>
            <div>
              <dt>{t('statGames')}</dt>
              <dd>{p.games}</dd>
            </div>
            <div>
              <dt>{t('statWins')}</dt>
              <dd>{p.wins}</dd>
            </div>
            <div>
              <dt>{t('statWinRate')}</dt>
              <dd>{p.games ? `${Math.round((100 * p.wins) / p.games)}%` : '–'}</dd>
            </div>
            <div>
              <dt>{t('statAvgScore')}</dt>
              <dd>{p.games ? (p.totalScore / p.games).toFixed(1) : '–'}</dd>
            </div>
            <div>
              <dt>{t('statBest')}</dt>
              <dd>{p.games ? p.bestScore : '–'}</dd>
            </div>
          </dl>
          <h3>{t('recentGames')}</h3>
          <ul className="seats" aria-label={t('recentGames')}>
            {p.recent.length === 0 && <li className="empty">{t('noGames')}</li>}
            {p.recent.map((g, i) => (
              <li key={`${g.at}-${i}`} className="seat">
                <div className="seat-top">
                  <span className="name">{academyName(g.academyId)}</span>
                  {g.won && <span className="tag">{t('winTag')}</span>}
                  <span className="pts">{t('points', { n: g.score })}</span>
                </div>
                <div className="seat-sub">
                  <span>{t('placeOf', { place: g.place, players: g.players })}</span>
                  <span>{new Date(g.at).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
