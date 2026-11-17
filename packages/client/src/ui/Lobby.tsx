import { useEffect, useState } from 'react';
import { ACADEMIES } from '@arcane/engine';
import type { LobbySeat } from '@arcane/protocol';
import { useSound } from '../audio/context';
import type { LobbyState, RoomConfig } from '../net/menuTypes';
import { useClient, useClientState, useT } from './context';
import { Crest } from './Icon';
import { AvatarGlyph } from './Avatar';
import { inviteLink } from '../net/url';
import { ReactionBubble, ReactionButton, useReactions } from './Reactions';
import { PlayerMenu } from './Safety';
import { RoomSettingsForm, duration, sideText, timerText } from './Rooms';

const GRACE = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000];

/** The room's config, or one read from the seats when the server sends none. */
export function configOf(lobby: LobbyState): RoomConfig {
  if (lobby.config) return lobby.config;
  const bots = lobby.seats.filter((s) => s.kind === 'bot');
  return {
    sideMode: 'random',
    turnTimerMs: lobby.settings.turnTimerMs,
    seats: Math.max(2, lobby.seats.length),
    public: false,
    bots: bots.length,
    botLevel: bots[0]?.botLevel ?? 'normal',
  };
}

export function Lobby(props: { onFriends?: () => void } = {}) {
  const client = useClient();
  const sound = useSound();
  const t = useT();
  const state = useClientState();
  const { seatId } = state;
  const lobby = state.lobby as LobbyState | null;
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
  // During a queue countdown the lobby runs itself: no host controls.
  const counting = startsAt !== null;
  const isHost = lobby.hostId === seatId && !counting;
  const config = configOf(lobby);
  const humans = lobby.seats.filter((s) => s.kind === 'human').length;
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
          <strong>{t('matchFound')}</strong>
          {counting && (
            <>
              <span className="deadline" role="timer">
                {t('quickStartsIn', { n: Math.max(0, Math.ceil((startsAt - now) / 1000)) })}
              </span>
              <span className="muted small center">{t('drawAtStart')}</span>
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

      {!lobby.quick && (
        <p className="room-summary muted small center" aria-label={t('roomSettings')}>
          {[
            `${t('side')}: ${sideText(t, config.sideMode)}`,
            `${t('turnTimer')}: ${timerText(t, config.turnTimerMs)}`,
            t('seatsN', { n: config.seats }),
            config.public ? t('public') : t('private'),
            ...(config.bots ? [`${t('bots')}: ${config.bots} · ${t(`level_${config.botLevel}`)}`] : []),
          ].join(' · ')}
        </p>
      )}

      <ul className="seats">
        {lobby.seats.map((s) => {
          const mine = s.id === seatId;
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
                {s.kind === 'bot' && <span className="tag">{`${t('bot')} · ${t(`level_${s.botLevel ?? 'normal'}`)}`}</span>}
                {isHost && !mine && s.kind === 'human' && !lobby.quick && (
                  <button className="link danger" aria-label={`${t('remove')} ${s.name}`} onClick={() => client.removeSeat(s.id)}>
                    ✕
                  </button>
                )}
              </div>
              {mine ? (
                <select aria-label={`${t('academy')}: ${s.name}`} value={s.academyId ?? ''} onChange={(e) => client.setSeat({ academyId: e.target.value || null })}>
                  <option value="">{t('random')}</option>
                  {ACADEMIES.map((a) => (
                    <option key={a.id} value={a.id} disabled={used.has(a.id)}>
                      {used.has(a.id) ? `${a.name} · ${t('takenTag')}` : a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="muted small">{ACADEMIES.find((a) => a.id === s.academyId)?.name ?? t('random')}</div>
              )}
            </li>
          );
        })}
        {!lobby.quick &&
          Array.from({ length: Math.max(0, config.seats - lobby.seats.length) }, (_, i) => (
            <li key={`free-${i}`} className="seat free-seat muted">
              {t('freeSeat')}
            </li>
          ))}
      </ul>

      {isHost ? (
        <section className="panel">
          <h3>{t('roomSettings')}</h3>
          <RoomSettingsForm config={config} minSeats={humans + config.bots} onChange={(patch) => client.roomConfig(patch)} />
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
          {lobby.seats.length < 2 && <p className="muted small">{t('seatsNeeded')}</p>}
          <button className="primary" disabled={lobby.seats.length < 2 || lobby.seats.length > 7} onClick={() => client.startGame()}>
            {t('start')}
          </button>
        </section>
      ) : (
        !counting && <p className="muted center">{t('waitingHost')}</p>
      )}

      {props.onFriends && !lobby.quick && <button onClick={props.onFriends}>{t('inviteFriends')}</button>}

      <button className="link" onClick={() => client.leave()}>
        {t('leave')}
      </button>
    </main>
  );
}
