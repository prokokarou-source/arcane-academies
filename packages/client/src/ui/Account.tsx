import { useState } from 'react';
import { MAX_PASSWORD, MIN_PASSWORD, USERNAME_RE } from '@arcane/protocol';
import { useClient, useClientState, useT } from './context';

/** Log in or create an account (username + password). Optional: guests can always play. */
export function Account(props: { onBack(): void; onFriends(): void; onPrivacy?(): void }) {
  const client = useClient();
  const t = useT();
  const { account, accountPending, socialError } = useClientState();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (account) {
    return (
      <main className="screen">
        <h2>{t('account')}</h2>
        <p>{t('signedInAs', { name: account })}</p>
        <button className="primary" onClick={props.onFriends}>
          {t('friends')}
        </button>
        <button onClick={() => client.logout()}>{t('logOut')}</button>
        <button className="link" onClick={props.onBack}>
          {t('back')}
        </button>
      </main>
    );
  }

  const name = username.trim();
  const ok = mode === 'login' ? name.length > 0 && password.length > 0 : USERNAME_RE.test(name) && password.length >= MIN_PASSWORD;
  const submit = () => {
    if (!ok || accountPending) return;
    if (mode === 'login') client.login(name, password);
    else client.signup(name, password);
  };

  return (
    <main className="screen">
      <h2>{mode === 'login' ? t('signIn') : t('signUp')}</h2>
      <p className="muted small">{t('guestNote')}</p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>{t('username')}</span>
          <input
            aria-label={t('username')}
            value={username}
            maxLength={20}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
          {mode === 'signup' && <span className="small">{t('usernameHint')}</span>}
        </label>
        <label className="field">
          <span>{t('password')}</span>
          <input
            aria-label={t('password')}
            type="password"
            value={password}
            maxLength={MAX_PASSWORD}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'signup' && <span className="small">{t('passwordHint')}</span>}
        </label>
        {mode === 'signup' && props.onPrivacy && (
          <button type="button" className="link small" onClick={props.onPrivacy}>
            {t('privacy')}
          </button>
        )}
        {socialError && (
          <div className="banner banner-error" role="alert">
            <span>{t(`error_${socialError.code}`)}</span>
          </div>
        )}
        <button className="primary" type="submit" disabled={!ok || accountPending}>
          {accountPending ? t('connecting') : mode === 'login' ? t('signIn') : t('signUp')}
        </button>
      </form>
      <button
        className="link"
        onClick={() => {
          client.clearSocialError();
          setMode(mode === 'login' ? 'signup' : 'login');
        }}
      >
        {mode === 'login' ? t('needAccount') : t('haveAccount')}
      </button>
      <button className="link" onClick={props.onBack}>
        {t('back')}
      </button>
    </main>
  );
}
