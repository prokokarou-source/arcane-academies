import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LobbySeat, LobbyState } from '@arcane/protocol';
import { renderApp } from './render';

afterEach(cleanup);

const seat = (id: string, name: string, extra: Partial<LobbySeat> = {}): LobbySeat => ({
  id,
  kind: 'human',
  name,
  academyId: null,
  side: 'A',
  connected: true,
  ...extra,
});

const lobbyOf = (seats: LobbySeat[], hostId = 's1'): LobbyState => ({
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId,
  seats,
  settings: { graceMs: 60_000, turnTimerMs: null },
});

function inLobby(me: string, lobby: LobbyState) {
  const h = renderApp();
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: me, token: 't' });
    h.sock().receive({ t: 'lobby', lobby });
  });
  h.sock().sent.length = 0;
  return h;
}

describe('Lobby', () => {
  it('shows code and seats', () => {
    inLobby('s1', lobbyOf([seat('s1', 'Ana'), seat('b1', 'Bot Ivy', { kind: 'bot', botLevel: 'hard' })]));
    expect(screen.getByText('WAND-42')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bot Ivy')).toBeTruthy();
  });

  it('host sees the room config, changes it and starts', () => {
    const lobby = { ...lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]), config: { sideMode: 'B', turnTimerMs: 60_000, seats: 4, public: true, bots: 0, botLevel: 'normal' } } as LobbyState;
    const h = inLobby('s1', lobby);
    expect(screen.getByLabelText('Room settings').textContent).toBe('Side: Side B · Turn timer: 1 min · 4 seats · Public');
    expect(screen.getAllByText('Free seat')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Bots' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(h.sock().sent).toEqual([
      { t: 'roomConfig', settings: { sideMode: 'random' } },
      { t: 'roomConfig', settings: { bots: 1 } },
      { t: 'roomConfig', settings: { public: false } },
      { t: 'start' },
    ]);
  });

  it('start is disabled with one seat', () => {
    inLobby('s1', lobbyOf([seat('s1', 'Ana')]));
    expect(screen.getByRole('button', { name: 'Start game' })).toHaveProperty('disabled', true);
  });

  it('non-host sees no host controls', () => {
    inLobby('s2', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]));
    expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add bot' })).toBeNull();
    expect(screen.getByText('Waiting for the host to start…')).toBeTruthy();
    expect(screen.queryByLabelText('Academy: Ana')).toBeNull();
  });

  it('picking an academy sends setSeat', () => {
    const h = inLobby('s2', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]));
    fireEvent.change(screen.getByLabelText('Academy: Bob'), { target: { value: 'runeforge' } });
    // No side pick: one side for the whole table.
    expect(screen.queryByLabelText('Side: Bob')).toBeNull();
    expect(h.sock().sent).toEqual([{ t: 'setSeat', academyId: 'runeforge' }]);
  });

  it('bots are set by count and one level; only humans can be removed', () => {
    const h = inLobby('s1', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob'), seat('b1', 'Bot Ivy', { kind: 'bot', botLevel: 'normal' })]));
    expect(screen.queryByLabelText('Academy: Bot Ivy')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Bot Ivy' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(h.sock().sent).toEqual([
      { t: 'roomConfig', settings: { botLevel: 'hard' } },
      { t: 'removeSeat', seatId: 's2' },
    ]);
  });

  it('academy taken by another seat is disabled', () => {
    inLobby('s2', lobbyOf([seat('s1', 'Ana', { academyId: 'pyromancy' }), seat('s2', 'Bob')]));
    const select = screen.getByLabelText('Academy: Bob') as HTMLSelectElement;
    const opt = [...select.options].find((o) => o.value === 'pyromancy')!;
    expect(opt.disabled).toBe(true);
  });

  it('turn timer and grace selects send settings in ms', () => {
    const h = inLobby('s1', lobbyOf([seat('s1', 'Ana')]));
    fireEvent.change(screen.getByLabelText('Turn timer'), { target: { value: '90000' } });
    fireEvent.change(screen.getByLabelText('Turn timer'), { target: { value: 'off' } });
    fireEvent.change(screen.getByLabelText('Bot takes over after'), { target: { value: '30000' } });
    expect(h.sock().sent).toEqual([
      { t: 'roomConfig', settings: { turnTimerMs: 90000 } },
      { t: 'roomConfig', settings: { turnTimerMs: null } },
      { t: 'settings', settings: { graceMs: 30000 } },
    ]);
  });

  it('leave sends leave', () => {
    const h = inLobby('s2', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(h.sock().sent).toEqual([{ t: 'leave' }]);
  });
});
