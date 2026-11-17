import { useEffect, useState, type ReactNode } from 'react';
import { ACADEMIES } from '@arcane/engine';
import type { LobbySeat } from '@arcane/protocol';
import { useSound } from '../audio/context';
import type { LobbyState, RoomConfig } from '../net/menuTypes';
import { useClient, useClientState, useT, type T } from './context';
import { Crest, crestColor } from './Icon';
import { AvatarGlyph } from './Avatar';
import { inviteLink } from '../net/url';
import { useWide } from './layout';
import { Glyph } from './Menu';
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

const academyName = (id: string | null) => ACADEMIES.find((a) => a.id === id)?.name;

/**
 * The lobby of a room (after Create Room or Join) and the "Match found" countdown of Casual/Ranked.
 * Rooms: top bar (Leave, code, Copy code, Share link), players with academy chips and free seats (+ Bot / Invite),
 * the room's settings, and a big Start game. Queue tables draw every academy: no picker there.
 */
export function Lobby(props: { onFriends?: () => void } = {}) {
  const state = useClientState();
  const lobby = state.lobby as LobbyState | null;
  if (!lobby) return null;
  return lobby.quick ? <MatchFound lobby={lobby} /> : <RoomLobby lobby={lobby} onFriends={props.onFriends} />;
}

/** Casual/Ranked: the table is set and starts by itself; academies are drawn at the start. */
function MatchFound({ lobby }: { lobby: LobbyState }) {
  const client = useClient();
  const t = useT();
  const { seatId } = useClientState();
  const [now, setNow] = useState(() => Date.now());
  const startsAt = lobby.startsAt ?? null;
  useEffect(() => {
    if (startsAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startsAt]);
  const reactions = useReactions();
  return (
    <main className="screen lobby match-found">
      <header className="lobby-head">
        <strong>{t('matchFound')}</strong>
        {startsAt !== null && (
          <span className="deadline" role="timer">
            {t('quickStartsIn', { n: Math.max(0, Math.ceil((startsAt - now) / 1000)) })}
          </span>
        )}
        <span className="muted small center">{t('drawAtStart')}</span>
      </header>
      <ul className="lobby-seats">
        {lobby.seats.map((s) => (
          <SeatRow key={s.id} seat={s} mine={s.id === seatId} host={false} drawn reaction={reactions.get(s.id)} />
        ))}
      </ul>
      <button className="link" onClick={() => client.leave()}>
        {t('leave')}
      </button>
    </main>
  );
}

function RoomLobby({ lobby, onFriends }: { lobby: LobbyState; onFriends?: () => void }) {
  const client = useClient();
  const sound = useSound();
  const t = useT();
  const wide = useWide();
  const { seatId } = useClientState();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [picking, setPicking] = useState(false);
  const reactions = useReactions();
  const isHost = lobby.hostId === seatId;
  const config = configOf(lobby);
  const free = Math.max(0, config.seats - lobby.seats.length);
  const link = inviteLink(lobby.code, location, typeof __LAN_ORIGIN__ === 'string' ? __LAN_ORIGIN__ : null);
  // Academies other players picked: nobody else can take them (Random stays open).
  const taken = new Set(lobby.seats.filter((s) => s.id !== seatId && s.academyId).map((s) => s.academyId!));
  const players = t('playersOf', { n: lobby.seats.length, seats: config.seats });

  const copy = async (what: 'code' | 'link') => {
    sound('tap');
    try {
      if (what === 'link' && navigator.share) await navigator.share({ title: t('appName'), url: link });
      else {
        await navigator.clipboard.writeText(what === 'code' ? lobby.code : link);
        setCopied(what);
      }
    } catch {
      // The user closed the share sheet, or the clipboard is not allowed.
    }
  };
  const invite = () => {
    if (onFriends) {
      sound('tap');
      onFriends();
    } else void copy('link');
  };

  const settings = isHost ? (
    <>
      <RoomSettingsForm config={config} inLobby minSeats={lobby.seats.length} onChange={(patch) => client.roomConfig(patch)} />
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
    </>
  ) : (
    <ReadOnlySettings t={t} config={config} graceMs={lobby.settings.graceMs} />
  );

  return (
    <main className="screen lobby room-lobby">
      <header className="lobby-bar">
        <button className="back" onClick={() => (sound('tap'), client.leave())}>
          <span className="chev" aria-hidden="true">
            ‹
          </span>
          {t('leave')}
        </button>
        <h2 className="lobby-title">
          <span>{t('roomX')}</span> <strong className="code">{lobby.code}</strong>
        </h2>
        <span className="lobby-share">
          <button className="outline" onClick={() => copy('code')}>
            {copied === 'code' ? t('copied') : t('copyCode')}
          </button>
          <button className="outline" onClick={() => copy('link')}>
            {copied === 'link' ? t('linkCopied') : t('shareLink')}
          </button>
        </span>
        <span className="muted small lobby-vis">{config.public ? t('public') : t('private')}</span>
      </header>

      <div className="lobby-cols">
        <section className="panel lobby-players" aria-label={players}>
          <h3>{players}</h3>
          <ul className="lobby-seats">
            {lobby.seats.map((s) => {
              const mine = s.id === seatId;
              return (
                <SeatRow
                  key={s.id}
                  seat={s}
                  mine={mine}
                  host={s.id === lobby.hostId}
                  reaction={reactions.get(s.id)}
                  picking={mine && picking}
                  onChip={mine ? () => (sound('tap'), setPicking((x) => !x)) : undefined}
                  onRemove={isHost && !mine ? () => client.removeSeat(s.id) : undefined}
                >
                  {mine && picking && (
                    <AcademyPicker
                      current={s.academyId}
                      taken={taken}
                      onPick={(id) => {
                        sound('tap');
                        setPicking(false);
                        if (id !== s.academyId) client.setSeat({ academyId: id });
                      }}
                      onClose={() => setPicking(false)}
                    />
                  )}
                </SeatRow>
              );
            })}
            {Array.from({ length: free }, (_, i) => (
              <li key={`free-${i}`} className="lobby-seat free">
                <span className="muted grow">{t('freeSeat')}</span>
                {isHost && (
                  <button className="outline" onClick={() => (sound('tap'), client.addBot(config.botLevel))}>
                    {t('plusBot')}
                  </button>
                )}
                <button className="outline" onClick={invite}>
                  {t('invite')}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {wide ? (
          <section className="panel lobby-settings" aria-label={t('roomSettings')}>
            <h3>{t('roomSettings')}</h3>
            {settings}
          </section>
        ) : (
          <details className="panel lobby-settings" aria-label={t('roomSettings')}>
            <summary>{t('roomSettings')}</summary>
            {settings}
          </details>
        )}
      </div>

      <div className="lobby-start">
        {isHost ? (
          <>
            <button className="primary start" disabled={lobby.seats.length > 7} onClick={() => (sound('tap'), client.startGame())}>
              {t('start')}
            </button>
            {free > 0 && <p className="hint center">{t('fillWithBots')}</p>}
          </>
        ) : (
          <p className="muted center">{t('waitingHost')}</p>
        )}
      </div>
    </main>
  );
}

/** One player in the lobby: avatar, name, tags, and the academy chip on the right. */
function SeatRow(props: {
  seat: LobbySeat;
  mine: boolean;
  host: boolean;
  /** Queue tables: academies are drawn, so no chip. */
  drawn?: boolean;
  picking?: boolean;
  reaction: ReturnType<ReturnType<typeof useReactions>['get']>;
  onChip?: () => void;
  onRemove?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const s = props.seat;
  const name = academyName(s.academyId);
  const chip = (
    <>
      {s.academyId ? <Crest academyId={s.academyId} size={22} /> : <span className="chip-q">?</span>}
      <span>{name ?? t('random')}</span>
    </>
  );
  const style = s.academyId ? { ['--crest' as string]: crestColor(s.academyId) } : undefined;
  return (
    <li className={`lobby-seat${props.mine ? ' mine' : ''}`}>
      <span className={`dot ${s.connected ? 'on' : 'off'}`} title={s.connected ? '' : t('offline')} />
      {s.kind === 'bot' ? (
        <span className="bot-face">
          <Glyph name="bots" size={20} />
        </span>
      ) : (
        <AvatarGlyph avatar={s.avatar} size={28} />
      )}
      <span className="name">
        {s.name}
        <ReactionBubble reaction={props.reaction} name={s.name} />
      </span>
      {/* Rooms mark my row with a gold border; the tag stays for screen readers. */}
      {props.mine && <span className={props.drawn ? 'tag' : 'sr-only'}>{t('you')}</span>}
      {props.mine && <ReactionButton />}
      {props.host && <span className="tag">{t('host')}</span>}
      {s.kind === 'bot' && <span className="tag">{`${t('bot')} · ${t(`level_${s.botLevel ?? 'normal'}`)}`}</span>}
      {!props.mine && s.username && <PlayerMenu username={s.username} />}
      {!props.drawn &&
        s.kind !== 'bot' &&
        (props.onChip ? (
          <button className="academy-chip" style={style} aria-label={t('academyOf', { name: s.name })} aria-expanded={!!props.picking} onClick={props.onChip}>
            {chip}
          </button>
        ) : (
          <span className="academy-chip" style={style}>
            {chip}
          </span>
        ))}
      {props.onRemove && (
        <button className="link danger" aria-label={`${t('remove')} ${s.name}`} onClick={props.onRemove}>
          ✕
        </button>
      )}
      {props.children}
    </li>
  );
}

/** A small grid: Random and every academy; ones other players picked are greyed "taken". */
function AcademyPicker(props: { current: string | null; taken: Set<string>; onPick(id: string | null): void; onClose(): void }) {
  const t = useT();
  return (
    <>
      <div className="picker-backdrop" onClick={props.onClose} />
      <div className="academy-picker" role="dialog" aria-label={t('chooseAcademy')}>
        <button className={props.current === null ? 'on' : ''} aria-pressed={props.current === null} onClick={() => props.onPick(null)}>
          <span className="chip-q">?</span>
          <span>{t('random')}</span>
        </button>
        {ACADEMIES.map((a) => {
          const used = props.taken.has(a.id);
          return (
            <button
              key={a.id}
              className={a.id === props.current ? 'on' : ''}
              aria-pressed={a.id === props.current}
              disabled={used}
              style={{ ['--crest' as string]: crestColor(a.id) }}
              onClick={() => props.onPick(a.id)}
            >
              <Crest academyId={a.id} size={22} />
              <span>{a.name}</span>
              {used && <span className="taken">{t('takenTag')}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Players who are not the host see the settings without controls. */
function ReadOnlySettings({ t, config, graceMs }: { t: T; config: RoomConfig; graceMs: number }) {
  const rows: [string, string][] = [
    [t('side'), sideText(t, config.sideMode)],
    [t('turnTimer'), timerText(t, config.turnTimerMs)],
    [t('seatsLabel'), String(config.seats)],
    [t('visibility'), config.public ? t('public') : t('private')],
    [t('botLevel'), t(`level_${config.botLevel}`)],
    [t('graceLabel'), duration(t, graceMs)],
  ];
  return (
    <dl className="settings-read">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
