import { useState } from 'react';
import { USERNAME_RE } from '@arcane/protocol';
import { useClient, useClientState, useT } from './context';

/** Friend list with online status, requests, and (inside a lobby) invites. */
export function Friends(props: { onBack(): void; onAccount(): void }) {
  const client = useClient();
  const t = useT();
  const { account, friends, socialError, lobby } = useClientState();
  const [name, setName] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());

  if (!account) {
    return (
      <main className="screen">
        <h2>{t('friends')}</h2>
        <button className="primary" onClick={props.onAccount}>
          {t('signInOrUp')}
        </button>
        <button className="link" onClick={props.onBack}>
          {t('back')}
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
      <h2>{t('friends')}</h2>
      <p className="muted small">{t('signedInAs', { name: account })}</p>

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
        {list.friends.length === 0 && <li className="muted small">{t('noFriends')}</li>}
        {list.friends.map((f) => (
          <li key={f.username} className="seat">
            <div className="seat-top">
              <span className={`dot ${f.online ? 'on' : 'off'}`} />
              <span className="name">{f.username}</span>
              <span className="muted small">{f.online ? t('online') : t('offline')}</span>
              {lobby && f.online && (
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
              <button className="link danger" aria-label={t('unfriend', { name: f.username })} onClick={() => client.removeFriend(f.username)}>
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

      <button className="link" onClick={props.onBack}>
        {t('back')}
      </button>
    </main>
  );
}
