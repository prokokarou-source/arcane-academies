import { useEffect, useState } from 'react';
import type { BotLevel } from '@arcane/engine';
import { useSound } from '../audio/context';
import { QUEUES, divisionOf, type Queue } from '../net/menuTypes';
import { useClient, useClientState, useT } from './context';
import { DivisionBadge, Glyph, LEVELS, Segmented, TabScreen } from './Menu';

export type PlayMode = 'bots' | 'casual' | 'ranked';

/** What the Play tab has selected; kept by the App so it survives tab switches. */
export interface PlaySel {
  mode: PlayMode;
  queue: Queue;
  bots: number;
  level: BotLevel;
}

export const DEFAULT_PLAY: PlaySel = { mode: 'bots', queue: '3-5', bots: 3, level: 'normal' };

/** Rough game length in minutes, shown on the cards. */
const MINUTES: Record<Queue, string> = { '1v1': '15', '3-5': '20–30', '6-7': '30–40' };
const BOT_COUNTS = [2, 3, 4, 5, 6];
/** Bots used when a lonely queue player gives up and plays offline. */
const BOTS_FOR: Record<Queue, number> = { '1v1': 2, '3-5': 3, '6-7': 5 };

function Meta({ items }: { items: { icon: string; text: string }[] }) {
  return (
    <span className="meta">
      {items.map((i) => (
        <span key={i.icon}>
          <Glyph name={i.icon} size={15} />
          {i.text}
        </span>
      ))}
    </span>
  );
}

export function Play(props: { sel: PlaySel; onSel(s: PlaySel): void; playName(): string; onLogin(): void }) {
  const client = useClient();
  const t = useT();
  const sound = useSound();
  const { account, profile } = useClientState();
  const { sel, onSel } = props;
  const set = (patch: Partial<PlaySel>) => onSel({ ...sel, ...patch });
  // Ranked cards show my rating: fetch my profile once when Ranked opens.
  const mine = profile?.me ? profile : null;
  useEffect(() => {
    if (sel.mode === 'ranked' && account && !mine) client.requestProfile();
  }, [sel.mode, account, mine, client]);

  const needsLogin = sel.mode === 'ranked' && !account;
  const start = () => {
    sound('tap');
    if (needsLogin) return props.onLogin();
    const name = props.playName();
    if (sel.mode === 'bots') client.solo(name, sel.bots, sel.level);
    else client.queueJoin(sel.mode, sel.queue, name);
  };

  return (
    <TabScreen
      className="play"
      action={
        <button className="primary start" onClick={start}>
          {needsLogin ? t('logInForRanked') : t('startGame')}
        </button>
      }
    >
      <Segmented
        kind="tabs"
        label={t('gameMode')}
        value={sel.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: 'bots', label: t('modeBots'), icon: 'bots' },
          { value: 'casual', label: t('modeCasual'), icon: 'casual' },
          { value: 'ranked', label: t('modeRanked'), icon: 'ranked' },
        ]}
      />

      {sel.mode === 'bots' ? (
        <section className="mode-card on" aria-label={t('botsTable')}>
          <div className="mode-top">
            <span className="mode-icon">
              <Glyph name="bots" size={30} />
            </span>
            <span className="mode-title">
              <strong>{t('botsTable')}</strong>
              <Meta
                items={[
                  { icon: 'clock', text: t('minutesShort', { n: '10–20' }) },
                  { icon: 'person', text: '1' },
                  { icon: 'bots', text: String(sel.bots) },
                ]}
              />
            </span>
          </div>
          <span className="mode-label">{t('opponents')}</span>
          <Segmented label={t('opponents')} value={sel.bots} onChange={(bots) => set({ bots })} options={BOT_COUNTS.map((n) => ({ value: n, label: String(n) }))} />
          <span className="mode-label">{t('botLevel')}</span>
          <Segmented label={t('botLevel')} value={sel.level} onChange={(level) => set({ level })} options={LEVELS.map((l) => ({ value: l, label: t(`level_${l}`) }))} />
          <p className="hint">{t('botsHint')}</p>
        </section>
      ) : (
        <div className="mode-list" role="radiogroup" aria-label={t('tableSize')}>
          {QUEUES.map((q) => {
            const on = q === sel.queue;
            const r = mine?.ranked.find((x) => x.queue === q);
            return (
              <button key={q} type="button" role="radio" aria-checked={on} className={`mode-card${on ? ' on' : ''}`} onClick={() => (sound('tap'), set({ queue: q }))}>
                <span className="mode-top">
                  <span className="mode-icon">
                    <Glyph name={q === '1v1' ? 'ranked' : 'casual'} size={30} />
                  </span>
                  <span className="mode-title">
                    <strong>{t(`queue_${q}`)}</strong>
                    <Meta
                      items={[
                        { icon: 'clock', text: t('minutesShort', { n: MINUTES[q] }) },
                        { icon: 'person', text: q === '1v1' ? '2' : q === '3-5' ? '3–5' : '6–7' },
                        { icon: 'bots', text: q === '1v1' ? t('archmageShort') : '0' },
                      ]}
                    />
                  </span>
                  {sel.mode === 'ranked' && account && (
                    <span className="mode-rating">
                      <DivisionBadge division={r?.division ?? divisionOf(r?.rating ?? null)} size={24} />
                      <span>{r?.rating ?? '—'}</span>
                    </span>
                  )}
                </span>
                {on && <span className="hint">{t(`queueHint_${q}`)}</span>}
              </button>
            );
          })}
          {needsLogin && <p className="hint center">{t('rankedNeedsLogin')}</p>}
        </div>
      )}
    </TabScreen>
  );
}

/** After this long with no match, offer to play against bots offline. */
export const ALONE_MS = 60_000;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Waiting in a Casual or Ranked queue: elapsed time, who else is searching, cancel. */
export function QueueWait(props: { playName(): string }) {
  const client = useClient();
  const { queue } = useClientState();
  const t = useT();
  const sound = useSound();
  const [now, setNow] = useState(() => Date.now());
  const [keepWaiting, setKeepWaiting] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!queue) return null;
  const waited = now - queue.since;

  return (
    <main className="screen center quick">
      <h2>{`${t(queue.kind === 'ranked' ? 'modeRanked' : 'modeCasual')} · ${t(`queue_${queue.queue}`)}`}</h2>
      <div className="seek" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="status" role="status">
        {t('quickSearching')}
      </p>
      <p className="quick-time">{t('quickWaited', { time: clock(waited) })}</p>
      {queue.searching > 0 && <p className="muted">{t('quickCount', { n: queue.searching })}</p>}
      {waited >= ALONE_MS && !keepWaiting && (
        <section className="panel">
          <p className="muted">{t('quickAlone')}</p>
          <button
            className="primary"
            onClick={() => {
              sound('tap');
              client.queueLeave();
              client.solo(props.playName(), BOTS_FOR[queue.queue], 'normal');
            }}
          >
            {t('quickBots')}
          </button>
          <button onClick={() => setKeepWaiting(true)}>{t('quickKeep')}</button>
        </section>
      )}
      <button className="link" onClick={() => (sound('tap'), client.queueLeave())}>
        {t('cancel')}
      </button>
    </main>
  );
}
