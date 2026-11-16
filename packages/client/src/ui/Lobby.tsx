import { useEffect, useState } from 'react';
import { ACADEMIES, type BotLevel } from '@arcane/engine';
import type { LobbySeat } from '@arcane/protocol';
import { useSound } from '../audio/context';
import { useClient, useClientState, useT, type T } from './context';
import { LEVELS } from './Home';
import { Crest } from './Icon';
import { AvatarGlyph } from './Avatar';
import { inviteLink } from '../net/url';
import { ReactionBubble, ReactionButton, useReactions } from './Reactions';
import { PlayerMenu } from './Safety';

const GRACE = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const TIMERS = [30_000, 60_000, 90_000, 120_000, 300_000];

const duration = (t: T, ms: number) => (ms < 60_000 ? t('seconds', { n: ms / 1000 }) : t('minutes', { n: ms / 60_000 }));

export function Lobby(props: { onFriends?: () => void } = {}) {
  const client = useClient();
  const sound = useSound();
  const t = useT();
  const { lobby, seatId } = useClientState();
  const [botLevel, setBotLevel] = useState<BotLevel>('normal');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const startsAt = lobby?.startsAt ?? null;
  useEffect(() => {
    if (startsAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startsAt]);
  const reactions = useReactions();
  if (!lobby) return null;
  // During a quick-match countdown the lobby runs itself: no host controls.
  const counting = startsAt !== null;
  const isHost = lobby.hostId === seatId && !counting;
  const taken = (s: LobbySeat) => new Set(lobby.seats.filter((x) => x.id !== s.id && x.academyId).map((x) => x.academyId));

  const link = inviteLink(lobby.code, location, typeof __LAN_ORIGIN__ === 'string' ? __LAN_ORIGIN__ : null);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('appName'), url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // The user closed the share sheet.
    }
  };

  return (
    <main className="screen lobby">
      {lobby.quick ? (
        <header className="lobby-head">
          <strong>{t('quickMatch')}</strong>
          {counting && (
            <>
              <span className="deadline" role="timer">
                {t('quickStartsIn', { n: Math.max(0, Math.ceil((startsAt - now) / 1000)) })}
              </span>
              <span className="muted small center">{t('quickFill')}</span>
            </>
          )}
        </header>
      ) : (
        <header className="lobby-head">
          <span className="muted">{t('roomCode')}</span>
          <strong className="code">{lobby.code}</strong>
          <button onClick={() => (sound('tap'), share())}>{copied ? t('linkCopied') : t('shareLink')}</button>
          <span className="muted small center">
            {t('inviteHint')} <span className="invite">{link}</span>
          </span>
        </header>
      )}

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
                {s.kind === 'human' && <AvatarGlyph avatar={s.avatar} size={24} />}
                <span className="name">
                  {s.name}
                  <ReactionBubble reaction={reactions.get(s.id)} name={s.name} />
                </span>
                {mine && <span className="tag">{t('you')}</span>}
                {mine && <ReactionButton />}
                {!mine && s.username && <PlayerMenu username={s.username} />}
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
                {isHost && !mine && !(lobby.quick && s.kind === 'human') && (
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
        !counting && <p className="muted center">{t('waitingHost')}</p>
      )}

      {props.onFriends && <button onClick={props.onFriends}>{t('inviteFriends')}</button>}

      <button className="link" onClick={() => client.leave()}>
        {t('leave')}
      </button>
    </main>
  );
}
