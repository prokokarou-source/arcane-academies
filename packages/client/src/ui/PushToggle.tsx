import { useEffect } from 'react';
import { usePush } from '../pwa/context';
import { useClient, useClientState, useT } from './context';

/** "Enable notifications" for invites and friend requests; hidden when the server or browser has no push. */
export function PushToggle() {
  const client = useClient();
  const t = useT();
  const { account, pushKey } = useClientState();
  const { status, busy, store } = usePush();

  // After a login on this device, link its existing subscription to the account.
  useEffect(() => {
    if (account && pushKey && status === 'on') void store?.sync((s) => client.savePush(s));
  }, [account, pushKey, status, store, client]);

  if (!account || !pushKey || !store || status === 'unsupported') return null;
  return (
    <section className="panel" aria-label={t('notifications')}>
      <h3>{t('notifications')}</h3>
      {status === 'install' && <p className="small">{t('pushIos')}</p>}
      {status === 'denied' && <p className="small">{t('pushDenied')}</p>}
      {status === 'off' && (
        <>
          <p className="muted small">{t('pushExplain')}</p>
          <button className="primary" disabled={busy} onClick={() => void store.enable(pushKey, (s) => client.savePush(s))}>
            {t('pushEnable')}
          </button>
        </>
      )}
      {status === 'on' && (
        <>
          <p className="small">{t('pushOn')}</p>
          <button disabled={busy} onClick={() => void store.disable((e) => client.removePush(e))}>
            {t('pushDisable')}
          </button>
        </>
      )}
    </section>
  );
}
