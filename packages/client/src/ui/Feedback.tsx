import { useState } from 'react';
import { FEEDBACK_KINDS, MAX_FEEDBACK_TEXT, shrinkImage, type FeedbackKind, type FeedbackResult } from '../net/api';
import { useClient, useClientState, useT } from './context';
import { Segmented } from './Menu';
import { ScreenHead } from './ScreenHead';

/** In-app feedback (logged-in players only). Username, device, app version and screen are attached by the app. */
export function Feedback({ onBack, onLogin, screen }: { onBack(): void; onLogin(): void; screen: string }) {
  const t = useT();
  const client = useClient();
  const { account } = useClientState();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [shotError, setShotError] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | FeedbackResult>('idle');

  if (!account)
    return (
      <main className="screen">
        <ScreenHead title={t('feedback')} onBack={onBack} />
        <section className="panel">
          <p>{t('feedbackLogin')}</p>
          <button className="primary" onClick={onLogin}>
            {t('logIn')}
          </button>
        </section>
      </main>
    );

  if (state === 'ok')
    return (
      <main className="screen">
        <ScreenHead title={t('feedback')} onBack={onBack} />
        <section className="panel feedback-thanks" role="status">
          <h3>{t('feedbackThanks')}</h3>
          <p className="muted">{t('feedbackThanksHint')}</p>
          <button className="primary" onClick={onBack}>
            {t('done')}
          </button>
        </section>
      </main>
    );

  const send = async () => {
    if (!text.trim() || state === 'sending') return;
    setState('sending');
    setState(await client.sendFeedback({ kind, text: text.trim(), screenshot: shot, screen }));
  };

  return (
    <main className="screen">
      <ScreenHead title={t('feedback')} onBack={onBack} />
      <form
        className="panel feedback-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Segmented<FeedbackKind>
          label={t('feedbackKind')}
          value={kind}
          onChange={setKind}
          options={FEEDBACK_KINDS.map((k) => ({ value: k, label: t(`feedback_${k}`) }))}
        />
        <label className="field">
          <span>{t(`feedbackPrompt_${kind}`)}</span>
          <textarea aria-label={t('feedbackText')} value={text} maxLength={MAX_FEEDBACK_TEXT} rows={6} onChange={(e) => setText(e.target.value)} />
          <span className="small muted">{`${text.length}/${MAX_FEEDBACK_TEXT}`}</span>
        </label>
        <div className="field">
          <span>{t('feedbackShot')}</span>
          {shot ? (
            <div className="feedback-shot">
              <img src={shot} alt={t('feedbackShot')} />
              <button type="button" className="link" onClick={() => setShot(null)}>
                {t('remove')}
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              aria-label={t('feedbackShot')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setShotError(false);
                shrinkImage(file).then(setShot, () => setShotError(true));
              }}
            />
          )}
          {shotError && <span className="small danger-text">{t('feedbackShotError')}</span>}
        </div>
        <p className="hint">{t('feedbackAttached', { name: account, version: __APP_VERSION__ })}</p>
        {(state === 'error' || state === 'too_many' || state === 'login') && (
          <p className="banner banner-error" role="alert">
            {t(state === 'too_many' ? 'feedbackTooMany' : state === 'login' ? 'feedbackLogin' : 'feedbackError')}
          </p>
        )}
        <button className="primary" type="submit" disabled={!text.trim() || state === 'sending'}>
          {state === 'sending' ? t('sending') : t('send')}
        </button>
      </form>
    </main>
  );
}
