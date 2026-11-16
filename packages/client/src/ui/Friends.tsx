import { useEffect, useState } from 'react';
import type { LeaderRow } from '@arcane/protocol';
import { USERNAME_RE } from '@arcane/protocol';
import { useClient, useClientState, useT } from './context';
import { PushToggle } from './PushToggle';
import { ScreenHead } from './ScreenHead';

/** Friend list with online status, requests, and (inside a lobby) invites. */
export function Friends(props: { onBack(): void; onAccount(): void }) {
  const client = useClient();
  const t = useT();
  const { account, friends, socialError, lobby } = useClientState();
  const [name, setName] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'list' | 'board'>('list');

  if (!account) {
    return (
      <main className="screen">
        <ScreenHead title={t('friends')} onBack={props.onBack} />
        <button className="primary" onClick={props.onAccount}>
          {t('signInOrUp')}
        </button>
      </main>
    );
  }

  const list = friends ?? { friends: [], incoming: [], outgoing: [] };
  const trimmed = name.trim();
  const add = () => {
    if (!USERNAME_RE.test(trimmed)) return;
    client.requestFriend(trimmed);
    setName('');
  };

  return (
    <main className="screen">
      <ScreenHead title={t('friends')} onBack={props.onBack} />
      <p className="muted small">{t('signedInAs', { name: account })}</p>
      <div className="row tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'primary' : ''} onClick={() => setTab('list')}>
          {t('friendList')}
        </button>
        <button role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'primary' : ''} onClick={() => setTab('board')}>
          {t('leaderboard')}
        </button>
      </div>
      {tab === 'board' ? (
        <Leaderboard />
      ) : (
        <>
          <form
            className="panel row"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              aria-label={t('friendName')}
              placeholder={t('friendName')}
              value={name}
              maxLength={20}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" disabled={!USERNAME_RE.test(trimmed)}>
              {t('addFriend')}
            </button>
          </form>
          {socialError && (
            <div className="banner banner-error" role="alert">
              <span>{t(`error_${socialError.code}`)}</span>
              <button className="link" onClick={() => client.clearSocialError()}>
                {t('dismiss')}
              </button>
            </div>
          )}

          {list.incoming.length > 0 && (
            <section>
              <h3>{t('requests')}</h3>
              <ul className="seats">
                {list.incoming.map((u) => (
                  <li key={u} className="seat">
                    <div className="seat-top">
                      <span className="name">{u}</span>
                      <button className="primary" onClick={() => client.acceptFriend(u)}>
                        {t('accept')}
                      </button>
                      <button className="link danger" onClick={() => client.removeFriend(u)}>
                        {t('decline')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ul className="seats" aria-label={t('friends')}>
            {list.friends.length === 0 && <li className="empty">{t('noFriends')}</li>}
            {list.friends.map((f) => (
              <li key={f.username} className="seat">
                <div className="seat-top">
                  <span className={`dot ${f.online ? 'on' : 'off'}`} />
                  <span className="name">{f.username}</span>
                  <span className="muted small">{f.online ? t('online') : t('offline')}</span>
                  {lobby && (
                    <button
                      disabled={invited.has(f.username)}
                      onClick={() => {
                        client.invite(f.username);
                        setInvited(new Set(invited).add(f.username));
                      }}
                    >
                      {invited.has(f.username) ? t('invited') : t('invite')}
                    </button>
                  )}
                  <button
                    className="link danger"
                    aria-label={t('unfriend', { name: f.username })}
                    onClick={() => client.removeFriend(f.username)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
            {list.outgoing.map((u) => (
              <li key={u} className="seat">
                <div className="seat-top">
                  <span className="dot off" />
                  <span className="name">{u}</span>
                  <span className="tag">{t('sent')}</span>
                  <button className="link danger" onClick={() => client.removeFriend(u)}>
                    {t('cancel')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <PushToggle />

    </main>
  );
}

const winRate = (r: LeaderRow) => (r.games ? Math.round((100 * r.wins) / r.games) : 0);

/** Me and my friends, ranked by wins (then win rate) on the server. */
function Leaderboard() {
  const client = useClient();
  const t = useT();
  const { leaderboard, friends } = useClientState();
  // Fetch when opened and again whenever the friend list changes.
  useEffect(() => client.requestLeaderboard(), [client, friends]);
  if (!leaderboard) return <p className="status loading">{t('loadingStats')}</p>;
  return (
    <ol className="seats" aria-label={t('leaderboard')}>
      {leaderboard.map((r, i) => (
        <li key={r.username} className={`seat${r.me ? ' lb-me' : ''}`}>
          <div className="seat-top">
            <span className="rank">{i + 1}</span>
            <span className="name">{r.me ? `${r.username} (${t('you')})` : r.username}</span>
            <span className="lb-stats">
              <span className="small">{`${t('statWins')}: ${r.wins}`}</span>
              <span className="muted small">{`${winRate(r)}% · ${t('statGames')}: ${r.games}`}</span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
