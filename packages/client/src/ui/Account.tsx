import { useState } from 'react';
import { MAX_PASSWORD, MIN_PASSWORD, USERNAME_RE } from '@arcane/protocol';
import { usePush } from '../pwa/context';
import { useClient, useClientState, useT } from './context';
import { PushToggle } from './PushToggle';

/** Log in or create an account (username + password). Optional: guests can always play. */
export function Account(props: { onBack(): void; onFriends(): void; onProfile(): void; onPrivacy?(): void }) {
  const client = useClient();
  const t = useT();
  const { account, accountPending, socialError } = useClientState();
  const push = usePush();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (account) {
    return (
      <main className="screen">
        <h2>{t('account')}</h2>
        <p>{t('signedInAs', { name: account })}</p>
        <button className="primary" onClick={props.onProfile}>
          {t('profile')}
        </button>
        <button onClick={props.onFriends}>{t('friends')}</button>
        <PushToggle />
        <button
          onClick={async () => {
            // This device should stop getting this account's notifications.
            if (push.store && push.status === 'on') await push.store.disable((e) => client.removePush(e));
            client.logout();
          }}
        >
          {t('logOut')}
        </button>
        <ManageAccount />
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

/** Change password, log out everywhere, delete the account. */
function ManageAccount() {
  const client = useClient();
  const t = useT();
  const { accountPending, socialError, passwordChanged } = useClientState();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const canChange = current.length > 0 && next.length >= MIN_PASSWORD && !accountPending;

  return (
    <section className="panel">
      <h3>{t('manageAccount')}</h3>
      {socialError && (
        <div className="banner banner-error" role="alert">
          <span>{t(`error_${socialError.code}`)}</span>
        </div>
      )}
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canChange) return;
          client.changePassword(current, next);
          setCurrent('');
          setNext('');
        }}
      >
        <label className="field">
          <span>{t('currentPassword')}</span>
          <input
            aria-label={t('currentPassword')}
            type="password"
            value={current}
            maxLength={MAX_PASSWORD}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('newPassword')}</span>
          <input
            aria-label={t('newPassword')}
            type="password"
            value={next}
            maxLength={MAX_PASSWORD}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)}
          />
          <span className="small">{t('passwordHint')}</span>
        </label>
        {passwordChanged && (
          <p className="small" role="status">
            {t('passwordChanged')}
          </p>
        )}
        <button type="submit" disabled={!canChange}>
          {t('changePassword')}
        </button>
      </form>
      <button onClick={() => client.logoutAll()}>{t('logOutAll')}</button>
      {!deleting ? (
        <button className="link danger" onClick={() => setDeleting(true)}>
          {t('deleteAccount')}
        </button>
      ) : (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!deletePassword || accountPending) return;
            client.deleteAccount(deletePassword);
            setDeletePassword('');
          }}
        >
          <p className="small">{t('deleteWarning')}</p>
          <label className="field">
            <span>{t('password')}</span>
            <input
              aria-label={t('password')}
              type="password"
              value={deletePassword}
              maxLength={MAX_PASSWORD}
              autoComplete="current-password"
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="danger" type="submit" disabled={!deletePassword || accountPending}>
              {t('deleteForever')}
            </button>
            <button type="button" className="link" onClick={() => setDeleting(false)}>
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
