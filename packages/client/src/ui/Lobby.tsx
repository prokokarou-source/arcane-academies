import { useState } from 'react';
import { ACADEMIES, type BotLevel } from '@arcane/engine';
import type { LobbySeat } from '@arcane/protocol';
import { useClient, useClientState, useT, type T } from './context';
import { LEVELS } from './Home';
import { Crest } from './Icon';

const GRACE = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const TIMERS = [30_000, 60_000, 90_000, 120_000, 300_000];

const duration = (t: T, ms: number) => (ms < 60_000 ? t('seconds', { n: ms / 1000 }) : t('minutes', { n: ms / 60_000 }));

export function Lobby() {
  const client = useClient();
  const t = useT();
  const { lobby, seatId } = useClientState();
  const [botLevel, setBotLevel] = useState<BotLevel>('normal');
  const [copied, setCopied] = useState(false);
  if (!lobby) return null;
  const isHost = lobby.hostId === seatId;
  const taken = (s: LobbySeat) => new Set(lobby.seats.filter((x) => x.id !== s.id && x.academyId).map((x) => x.academyId));

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('appName'), url: lobby.inviteUrl });
      else {
        await navigator.clipboard.writeText(lobby.inviteUrl);
        setCopied(true);
      }
    } catch {
      // The user closed the share sheet.
    }
  };

  return (
    <main className="screen lobby">
      <header className="lobby-head">
        <span className="muted">{t('roomCode')}</span>
        <strong className="code">{lobby.code}</strong>
        <button onClick={share}>{copied ? t('linkCopied') : t('shareLink')}</button>
      </header>

      <ul className="seats">
        {lobby.seats.map((s) => {
          const mine = s.id === seatId;
          const editable = mine || (isHost && s.kind === 'bot');
          const target = mine ? {} : { seatId: s.id };
          const used = taken(s);
          return (
            <li key={s.id} className="seat">
              <div className="seat-top">
                <span className={`dot ${s.connected ? 'on' : 'off'}`} title={s.connected ? '' : t('offline')} />
                {s.academyId && <Crest academyId={s.academyId} size={24} />}
                <span className="name">{s.name}</span>
                {mine && <span className="tag">{t('you')}</span>}
                {s.id === lobby.hostId && <span className="tag">{t('host')}</span>}
                {s.kind === 'bot' && !isHost && <span className="tag">{`${t('bot')} · ${t(`level_${s.botLevel ?? 'normal'}`)}`}</span>}
                {isHost && s.kind === 'bot' && (
                  <select aria-label={`${t('level')}: ${s.name}`} value={s.botLevel ?? 'normal'} onChange={(e) => client.setBotLevel(s.id, e.target.value as BotLevel)}>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {`${t('bot')} · ${t(`level_${l}`)}`}
                      </option>
                    ))}
                  </select>
                )}
                {isHost && !mine && (
                  <button className="link danger" aria-label={`${t('remove')} ${s.name}`} onClick={() => client.removeSeat(s.id)}>
                    ✕
                  </button>
                )}
              </div>
              {editable ? (
                <div className="row">
                  <select
                    aria-label={`${t('academy')}: ${s.name}`}
                    value={s.academyId ?? ''}
                    onChange={(e) => client.setSeat({ ...target, academyId: e.target.value || null })}
                  >
                    <option value="">{t('random')}</option>
                    {ACADEMIES.map((a) => (
                      <option key={a.id} value={a.id} disabled={used.has(a.id)}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label={`${t('side')}: ${s.name}`} value={s.side} onChange={(e) => client.setSeat({ ...target, side: e.target.value as 'A' | 'B' })}>
                    <option value="A">{`${t('side')} A`}</option>
                    <option value="B">{`${t('side')} B`}</option>
                  </select>
                </div>
              ) : (
                <div className="muted small">
                  {(ACADEMIES.find((a) => a.id === s.academyId)?.name ?? t('random')) + ` · ${t('side')} ${s.side}`}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {isHost ? (
        <section className="panel">
          <div className="row">
            <select aria-label={t('newBotLevel')} value={botLevel} onChange={(e) => setBotLevel(e.target.value as BotLevel)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`level_${l}`)}
                </option>
              ))}
            </select>
            <button disabled={lobby.seats.length >= 7} onClick={() => client.addBot(botLevel)}>
              {t('addBot')}
            </button>
          </div>
          <label className="field">
            <span>{t('graceLabel')}</span>
            <select aria-label={t('graceLabel')} value={lobby.settings.graceMs} onChange={(e) => client.updateSettings({ graceMs: Number(e.target.value) })}>
              {GRACE.map((ms) => (
                <option key={ms} value={ms}>
                  {duration(t, ms)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('turnTimer')}</span>
            <select
              aria-label={t('turnTimer')}
              value={lobby.settings.turnTimerMs ?? 'off'}
              onChange={(e) => client.updateSettings({ turnTimerMs: e.target.value === 'off' ? null : Number(e.target.value) })}
            >
              <option value="off">{t('off')}</option>
              {TIMERS.map((ms) => (
                <option key={ms} value={ms}>
                  {duration(t, ms)}
                </option>
              ))}
            </select>
          </label>
          {lobby.seats.length < 2 && <p className="muted small">{t('seatsNeeded')}</p>}
          <button className="primary" disabled={lobby.seats.length < 2 || lobby.seats.length > 7} onClick={() => client.startGame()}>
            {t('start')}
          </button>
        </section>
      ) : (
        <p className="muted center">{t('waitingHost')}</p>
      )}

      <button className="link" onClick={() => client.leave()}>
        {t('leave')}
      </button>
    </main>
  );
}
