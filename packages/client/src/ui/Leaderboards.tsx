import { useEffect, useState } from 'react';
import { useSound } from '../audio/context';
import { QUEUES, continentOf, type LeaderRow, type Queue, type Scope } from '../net/menuTypes';
import { useClient, useClientState, useT } from './context';
import { DivisionBadge, Flag, Glyph, Segmented, TabScreen, countryName } from './Menu';

const MEDAL = ['🥇', '🥈', '🥉'];

function Row({ r, me, onOpen }: { r: LeaderRow; me?: boolean; onOpen(username: string): void }) {
  const t = useT();
  return (
    <tr className={me ? 'lb-me' : ''}>
      <td className="lb-rank">
        {r.rank === null ? '–' : r.rank}
        {r.rank !== null && r.rank <= 3 && (
          <span className="medal" aria-hidden="true">
            {MEDAL[r.rank - 1]}
          </span>
        )}
      </td>
      <td className="lb-player">
        <button className="link" onClick={() => onOpen(r.username)} aria-label={t('profileOf', { name: r.username })}>
          <Flag country={r.country} />
          <span className="name">{me ? `${r.username} (${t('you')})` : r.username}</span>
        </button>
      </td>
      <td className="lb-div">
        <DivisionBadge division={r.division} size={24} />
      </td>
      <td className="lb-rating">{r.rating ?? t('na')}</td>
    </tr>
  );
}

/** One permanent ranking per Ranked queue, by scope; my row is pinned at the bottom. */
export function Leaderboards(props: { queue: Queue; onQueue(q: Queue): void; onOpen(username: string): void; onPlay(q: Queue): void }) {
  const client = useClient();
  const t = useT();
  const sound = useSound();
  const { account, leaderboard, profile } = useClientState();
  const [scope, setScope] = useState<Scope>('global');
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [sent, setSent] = useState('');
  const queue = props.queue;
  const mine = profile?.me ? profile : null;
  const country = mine?.country ?? null;
  const continent = continentOf(country);

  useEffect(() => {
    if (account && !mine) client.requestProfile();
  }, [account, mine, client]);
  // Friends needs an account; continent and country need my flag.
  const scopeOk = scope === 'global' || (scope === 'friends' ? !!account : scope === 'continent' ? !!continent : !!country);
  const shown: Scope = scopeOk ? scope : 'global';
  useEffect(() => client.requestLeaderboard(queue, shown, sent || undefined), [client, queue, shown, sent]);

  const board = leaderboard && leaderboard.queue === queue && leaderboard.scope === shown ? leaderboard : null;
  const scopes: { value: Scope; label: string }[] = [
    ...(account ? [{ value: 'friends' as Scope, label: t('scope_friends') }] : []),
    { value: 'global', label: t('scope_global') },
    ...(continent ? [{ value: 'continent' as Scope, label: t(`continent_${continent}`) }] : []),
    ...(country ? [{ value: 'country' as Scope, label: countryName(country) }] : []),
  ];

  return (
    <TabScreen
      className="boards"
      action={
        <button className="primary start" onClick={() => (sound('tap'), props.onPlay(queue))}>
          {t('playQueue', { queue: t(`queue_${queue}`) })}
        </button>
      }
    >
      <Segmented kind="tabs" label={t('tabBoards')} value={queue} onChange={props.onQueue} options={QUEUES.map((q) => ({ value: q, label: t(`queue_${q}`) }))} />
      <div className="chips-row">
        <div className="chips" role="radiogroup" aria-label={t('scope')}>
          {scopes.map((s) => (
            <button key={s.value} role="radio" aria-checked={s.value === shown} className={`chip${s.value === shown ? ' on' : ''}`} onClick={() => setScope(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className={`chip icon${searching ? ' on' : ''}`} aria-label={t('searchPlayers')} aria-expanded={searching} onClick={() => setSearching(!searching)}>
          <Glyph name="search" size={18} />
        </button>
      </div>
      {searching && (
        <form
          className="row"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(search.trim());
          }}
        >
          <input aria-label={t('searchPlayers')} placeholder={t('searchPlayers')} value={search} maxLength={20} autoCapitalize="none" spellCheck={false} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit">{t('search')}</button>
        </form>
      )}
      {!account && <p className="hint">{t('boardsGuest')}</p>}

      {!board ? (
        <p className="status loading">{t('loadingStats')}</p>
      ) : (
        <table className="board" aria-label={t('leaderboard')}>
          <thead>
            <tr>
              <th>{t('rank')}</th>
              <th>{t('player')}</th>
              <th>{t('division')}</th>
              <th>{t('rating')}</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {t('noRanked')}
                </td>
              </tr>
            )}
            {board.rows.map((r) => (
              <Row key={r.username} r={r} me={!!account && r.username.toLowerCase() === account.toLowerCase()} onOpen={props.onOpen} />
            ))}
          </tbody>
          {board.me && (
            <tfoot>
              <Row r={board.me} me onOpen={props.onOpen} />
            </tfoot>
          )}
        </table>
      )}
    </TabScreen>
  );
}
