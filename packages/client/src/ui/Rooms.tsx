import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSound } from '../audio/context';
import { DEFAULT_ROOM, type OpenRoom, type RoomConfig, type SideMode } from '../net/menuTypes';
import { useClient, useClientState, useT, type T } from './context';
import { Glyph, LEVELS, Segmented, Stepper, TabScreen } from './Menu';
import { ScreenHead } from './ScreenHead';

export const TIMERS = [30_000, 60_000, 90_000, 120_000, 300_000];

export const duration = (t: T, ms: number) => (ms < 60_000 ? t('seconds', { n: ms / 1000 }) : t('minutes', { n: ms / 60_000 }));
export const timerText = (t: T, ms: number | null) => (ms === null ? t('off') : duration(t, ms));
export const sideText = (t: T, s: SideMode) => (s === 'random' ? t('sideRandom') : t('sideX', { side: s }));

/** Seat icons: humans filled, bots filled and dim, free seats outlined. */
export function SeatIcons({ seats, taken, bots }: { seats: number; taken: number; bots: number }) {
  return (
    <span className="seat-icons" aria-hidden="true">
      {Array.from({ length: seats }, (_, i) => (
        <span key={i} className={i < taken ? 'taken' : i < taken + bots ? 'bot' : 'free'}>
          <Glyph name={i >= taken && i < taken + bots ? 'bots' : 'person'} size={16} />
        </span>
      ))}
    </span>
  );
}

export function Rooms(props: { playName(): string; initialCode?: string; onCreate(): void }) {
  const client = useClient();
  const t = useT();
  const sound = useSound();
  const { rooms } = useClientState();
  const [soon, setSoon] = useState(false);
  const [joining, setJoining] = useState(!!props.initialCode);
  useEffect(() => {
    client.watchRooms();
    return () => client.unwatchRooms();
  }, [client]);

  const freeOf = (r: OpenRoom) => r.seats - r.taken - r.bots;

  return (
    <TabScreen
      className="rooms"
      action={
        <div className="row stretch">
          <button className="outline" onClick={() => (sound('tap'), setJoining(true))}>
            {t('joinRoom')}
          </button>
          <button className="primary" onClick={() => (sound('tap'), props.onCreate())}>
            {t('createRoom')}
          </button>
        </div>
      }
    >
      <Segmented
        kind="tabs"
        label={t('tabRooms')}
        value="open"
        onChange={(v) => setSoon(v === 'spectate')}
        options={[
          { value: 'open', label: t('openRooms'), icon: 'open' },
          { value: 'spectate', label: t('spectate'), icon: 'eye' },
        ]}
      />
      {soon && (
        <div className="banner" role="status">
          <span>{t('comingSoon')}</span>
          <button className="link" onClick={() => setSoon(false)}>
            {t('gotIt')}
          </button>
        </div>
      )}

      <div className="room-table" role="table" aria-label={t('openRooms')}>
        <div className="room-row head" role="row">
          <span role="columnheader">{t('host')}</span>
          <span role="columnheader">{t('side')}</span>
          <span role="columnheader">{t('turnTimer')}</span>
          <span role="columnheader">{t('seatsCol')}</span>
        </div>
        {rooms === null ? (
          <p className="status loading">{t('loadingRooms')}</p>
        ) : rooms.length === 0 ? (
          <p className="empty">{t('noRooms')}</p>
        ) : (
          rooms.map((r) => (
            <button
              key={r.code}
              role="row"
              className="room-row"
              aria-label={t('joinRoomOf', { name: r.host, free: freeOf(r) })}
              onClick={() => {
                sound('tap');
                client.join(r.code, props.playName());
              }}
            >
              <span role="cell" className="name">
                {r.host}
              </span>
              <span role="cell" className={`side-badge side-${r.sideMode}`}>
                {r.sideMode === 'random' ? '?' : r.sideMode}
              </span>
              <span role="cell">{timerText(t, r.turnTimerMs)}</span>
              <span role="cell">
                <SeatIcons seats={r.seats} taken={r.taken} bots={r.bots} />
              </span>
            </button>
          ))
        )}
      </div>

      {joining && <JoinSheet initial={props.initialCode ?? ''} playName={props.playName} onClose={() => setJoining(false)} />}
    </TabScreen>
  );
}

function JoinSheet(props: { initial: string; playName(): string; onClose(): void }) {
  const client = useClient();
  const t = useT();
  const [code, setCode] = useState(props.initial.toUpperCase());
  const ok = code.trim().length > 0;
  return createPortal(
    <div className="sheet-backdrop" onClick={props.onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label={t('joinRoom')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          client.join(code.trim(), props.playName());
          props.onClose();
        }}
      >
        <header className="sheet-head">
          <h3>{t('joinRoom')}</h3>
          <span className="muted small">{t('joinRoomHint')}</span>
        </header>
        <input
          aria-label={t('roomCode')}
          placeholder={t('roomCode')}
          value={code}
          maxLength={16}
          autoCapitalize="characters"
          autoFocus
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="primary" type="submit" disabled={!ok}>
          {t('join')}
        </button>
      </form>
    </div>,
    document.body,
  );
}

/** The room's settings: used before creating it and by the host in the lobby. */
export function RoomSettingsForm(props: { config: RoomConfig; onChange(patch: Partial<RoomConfig>): void; minSeats?: number; inLobby?: boolean }) {
  const t = useT();
  const c = props.config;
  return (
    <>
      <div className="setting">
        <span className="mode-label">{t('side')}</span>
        <Segmented
          label={t('side')}
          value={c.sideMode}
          onChange={(sideMode) => props.onChange({ sideMode })}
          options={[
            { value: 'A', label: t('sideX', { side: 'A' }) },
            { value: 'B', label: t('sideX', { side: 'B' }) },
            { value: 'random', label: t('sideRandom') },
          ]}
        />
      </div>
      <label className="field">
        <span>{t('turnTimer')}</span>
        <select
          aria-label={t('turnTimer')}
          value={c.turnTimerMs ?? 'off'}
          onChange={(e) => props.onChange({ turnTimerMs: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          <option value="off">{t('off')}</option>
          {TIMERS.map((ms) => (
            <option key={ms} value={ms}>
              {duration(t, ms)}
            </option>
          ))}
        </select>
      </label>
      <div className="setting row">
        <span className="mode-label grow">{t('seatsLabel')}</span>
        <Stepper
          label={t('seatsLabel')}
          value={c.seats}
          min={Math.max(2, props.minSeats ?? 2)}
          max={7}
          onChange={(seats) => props.onChange({ seats, bots: Math.min(c.bots, seats - 1) })}
        />
      </div>
      <div className="setting">
        <span className="mode-label">{t('visibility')}</span>
        <Segmented
          label={t('visibility')}
          value={c.public ? 'public' : 'private'}
          onChange={(v) => props.onChange({ public: v === 'public' })}
          options={[
            { value: 'public', label: t('public') },
            { value: 'private', label: t('private') },
          ]}
        />
        <span className="hint">{c.public ? t('publicHint') : t('privateHint')}</span>
      </div>
      {/* In the lobby every free seat has its own "+ Bot", and empty seats get bots on Start: only their level is set here. */}
      {!props.inLobby && (
        <div className="setting row">
          <span className="mode-label grow">{t('bots')}</span>
          <Stepper label={t('bots')} value={c.bots} min={0} max={c.seats - 1} onChange={(bots) => props.onChange({ bots })} />
        </div>
      )}
      {(c.bots > 0 || props.inLobby) && (
        <div className="setting">
          <span className="mode-label">{t('botLevel')}</span>
          <Segmented label={t('botLevel')} value={c.botLevel} onChange={(botLevel) => props.onChange({ botLevel })} options={LEVELS.map((l) => ({ value: l, label: t(`level_${l}`) }))} />
        </div>
      )}
    </>
  );
}

/** Choose the room's settings, then create it: the lobby follows. */
export function CreateRoom(props: { onBack(): void; playName(): string }) {
  const client = useClient();
  const t = useT();
  const sound = useSound();
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_ROOM);
  return (
    <main className="screen create-room">
      <ScreenHead title={t('createRoom')} onBack={props.onBack} />
      <section className="panel">
        <RoomSettingsForm config={config} onChange={(p) => setConfig({ ...config, ...p })} />
      </section>
      <p className="hint center">{t('academyLater')}</p>
      <button
        className="primary start"
        onClick={() => {
          sound('tap');
          client.createRoom(props.playName(), config);
        }}
      >
        {t('createRoom')}
      </button>
    </main>
  );
}
