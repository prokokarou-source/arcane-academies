import { useEffect } from 'react';
import { ACADEMIES } from '@arcane/engine';
import { COUNTRIES, QUEUES, type Profile as ProfileData } from '../net/menuTypes';
import { useClient, useClientState, useT, type T } from './context';
import { ScreenHead } from './ScreenHead';
import { AvatarGlyph, AvatarPicker } from './Avatar';
import { Crest } from './Icon';
import { DivisionBadge, Flag, countryName } from './Menu';
import { PlayerMenu } from './Safety';

export const academyName = (id: string) => ACADEMIES.find((a) => a.id === id)?.name ?? id;
const pct = (wins: number, games: number) => (games ? `${Math.round((100 * wins) / games)}%` : '–');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const modeOf = (t: T, g: ProfileData['recent'][number]) =>
  g.kind === 'ranked' || g.kind === 'casual' ? `${t(g.kind === 'ranked' ? 'modeRanked' : 'modeCasual')}${g.queue ? ` · ${t(`queue_${g.queue}`)}` : ''}` : t(`kind_${g.kind}`);

/** Country picker for my own profile. */
export function CountrySelect({ value }: { value: string | null }) {
  const client = useClient();
  const t = useT();
  const codes = Object.keys(COUNTRIES).sort((a, b) => countryName(a).localeCompare(countryName(b), 'en'));
  return (
    <label className="field">
      <span>{t('country')}</span>
      <select aria-label={t('country')} value={value ?? ''} onChange={(e) => client.setCountry(e.target.value || null)}>
        <option value="">{t('noCountry')}</option>
        {codes.map((c) => (
          <option key={c} value={c}>
            {countryName(c)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A player's profile: mine (editable avatar and country) or someone else's (read-only). */
export function Profile(props: { username?: string; onBack(): void }) {
  const client = useClient();
  const t = useT();
  const { profile, account, avatar, friends } = useClientState();
  const other = props.username && !(account && same(props.username, account)) ? props.username : undefined;
  useEffect(() => client.requestProfile(other), [client, other]);
  const p = profile && (other ? same(profile.username, other) && !profile.me : profile.me) ? profile : null;
  const isFriend = !!other && !!friends?.friends.some((f) => same(f.username, other));
  const asked = !!other && !!friends?.outgoing.some((u) => same(u, other));
  const fav = p?.academies.reduce<ProfileData['academies'][number] | null>((best, a) => (!best || a.games > best.games ? a : best), null);

  return (
    <main className="screen profile">
      <ScreenHead title={t('profile')} onBack={props.onBack} />
      {!p ? (
        <p className="status loading">{t('loadingStats')}</p>
      ) : (
        <>
          <section className="panel id-card">
            <AvatarGlyph avatar={p.me ? avatar : p.avatar} size={64} label={t('avatarOf', { name: p.username })} />
            <h3 className="who">
              <Flag country={p.country} />
              {p.username}
              {!p.me && <PlayerMenu username={p.username} />}
            </h3>
            <p className="muted small">{t('memberSince', { date: new Date(p.memberSince).toLocaleDateString() })}</p>
            {p.me ? (
              <details className="avatar-edit">
                <summary>{t('editProfile')}</summary>
                <AvatarPicker value={avatar} onPick={(a) => client.setAvatar(a)} />
                <CountrySelect value={p.country} />
              </details>
            ) : (
              account &&
              !isFriend && (
                <button disabled={asked} onClick={() => client.requestFriend(p.username)}>
                  {asked ? t('sent') : t('addFriend')}
                </button>
              )
            )}
          </section>

          <h3>{t('modeRanked')}</h3>
          <div className="ranked-tiles">
            {QUEUES.map((q) => {
              const r = p.ranked.find((x) => x.queue === q);
              return (
                <div key={q} className="ranked-tile" aria-label={`${t('modeRanked')} ${t(`queue_${q}`)}`}>
                  <span className="muted small">{t(`queue_${q}`)}</span>
                  <DivisionBadge division={r?.division ?? 'apprentice'} size={34} />
                  <strong>{r?.rating ?? t('na')}</strong>
                  <span className="muted small">{r?.rank ? t('rankGlobal', { n: r.rank }) : '–'}</span>
                  {r?.countryRank ? <span className="muted small">{t('rankCountry', { n: r.countryRank })}</span> : null}
                </div>
              );
            })}
          </div>

          <dl className="stat-tiles" aria-label={t('totals')}>
            <div>
              <dt>{t('statGames')}</dt>
              <dd>{p.totals.games}</dd>
            </div>
            <div>
              <dt>{t('statWins')}</dt>
              <dd>{p.totals.wins}</dd>
            </div>
            <div>
              <dt>{t('statWinRate')}</dt>
              <dd>{pct(p.totals.wins, p.totals.games)}</dd>
            </div>
            <div>
              <dt>{t('statAvgScore')}</dt>
              <dd>{p.totals.games ? (p.totals.totalScore / p.totals.games).toFixed(1) : '–'}</dd>
            </div>
            <div>
              <dt>{t('statBest')}</dt>
              <dd>{p.totals.games ? p.totals.bestScore : '–'}</dd>
            </div>
            <div>
              <dt>{t('statStreak')}</dt>
              <dd>{`${p.totals.streak} / ${p.totals.bestStreak}`}</dd>
            </div>
          </dl>

          <div className="kind-row">
            {(['casual', 'ranked'] as const).map((k) => (
              <div key={k} className="subpanel">
                <strong>{t(k === 'casual' ? 'modeCasual' : 'modeRanked')}</strong>
                <span className="muted small">{`${t('statGames')}: ${p.byKind[k].games} · ${t('statWinRate')}: ${pct(p.byKind[k].wins, p.byKind[k].games)}`}</span>
              </div>
            ))}
          </div>

          <h3>{t('academies')}</h3>
          <ul className="academy-stats" aria-label={t('academies')}>
            {p.academies.length === 0 && <li className="empty">{t('noGames')}</li>}
            {p.academies.map((a) => (
              <li key={a.academyId} className={fav?.academyId === a.academyId ? 'fav' : ''}>
                <Crest academyId={a.academyId} size={26} />
                <span className="name">{academyName(a.academyId)}</span>
                {fav?.academyId === a.academyId && <span className="tag">{t('favourite')}</span>}
                <span className="muted small">{`${a.games} · ${pct(a.wins, a.games)}`}</span>
              </li>
            ))}
          </ul>

          <h3>{t('recentGames')}</h3>
          <ul className="seats" aria-label={t('recentGames')}>
            {p.recent.length === 0 && <li className="empty">{t('noGames')}</li>}
            {p.recent.map((g, i) => (
              <li key={`${g.at}-${i}`} className="seat">
                <div className="seat-top">
                  <Crest academyId={g.academyId} size={24} />
                  <span className="name">{`${academyName(g.academyId)} · ${t('sideX', { side: g.side })}`}</span>
                  {g.place === 1 && <span className="tag">{t('winTag')}</span>}
                  <span className="pts">{t('points', { n: g.score })}</span>
                </div>
                <div className="seat-sub">
                  <span>{modeOf(t, g)}</span>
                  <span>{t('placeOf', { place: g.place, players: g.players })}</span>
                  {g.ratingDelta !== undefined && <span className={g.ratingDelta >= 0 ? 'up' : 'down'}>{`${g.ratingDelta >= 0 ? '+' : '−'}${Math.abs(g.ratingDelta)}`}</span>}
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
