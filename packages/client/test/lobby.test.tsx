import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LobbySeat, LobbyState } from '@arcane/protocol';
import { renderApp } from './render';

afterEach(cleanup);

const seat = (id: string, name: string, extra: Partial<LobbySeat> = {}): LobbySeat => ({
  id,
  kind: 'human',
  name,
  academyId: null,
  connected: true,
  ...extra,
});

const lobbyOf = (seats: LobbySeat[], hostId = 's1'): LobbyState => ({
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId,
  seats,
  settings: { graceMs: 60_000, turnTimerMs: null },
  config: { sideMode: 'random' as const, turnTimerMs: null, seats: 7, public: false, bots: seats.filter((x) => x.kind === 'bot').length, botLevel: 'normal' as const },
  kind: 'room' as const,
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
  it('shows the code, the seats and no LAN hint', () => {
    inLobby('s1', lobbyOf([seat('s1', 'Ana'), seat('b1', 'Bot Ivy', { kind: 'bot', botLevel: 'hard' })]));
    expect(screen.getByText('WAND-42')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bot Ivy')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share link' })).toBeTruthy();
    expect(screen.queryByText(/same Wi-Fi/)).toBeNull();
    expect(screen.getByText('Players 2/7')).toBeTruthy();
  });

  it('host changes the room settings (no Bots count there) and starts', () => {
    const lobby = { ...lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]), config: { sideMode: 'B', turnTimerMs: 60_000, seats: 4, public: true, bots: 0, botLevel: 'normal' } } as LobbyState;
    const h = inLobby('s1', lobby);
    expect(screen.getAllByText('Free seat')).toHaveLength(2);
    expect(screen.queryByRole('group', { name: 'Bots' })).toBeNull();
    expect(screen.getByText('Empty seats are filled with bots when you start.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(h.sock().sent).toEqual([
      { t: 'roomConfig', settings: { sideMode: 'random' } },
      { t: 'roomConfig', settings: { botLevel: 'hard' } },
      { t: 'roomConfig', settings: { public: false } },
      { t: 'start' },
    ]);
  });

  it('every free seat has + Bot (at the room bot level) and Invite', () => {
    const lobby = { ...lobbyOf([seat('s1', 'Ana')]), config: { sideMode: 'random', turnTimerMs: null, seats: 3, public: false, bots: 0, botLevel: 'easy' } } as LobbyState;
    const h = inLobby('s1', lobby);
    const plus = screen.getAllByRole('button', { name: '+ Bot' });
    expect(plus).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Invite' })).toHaveLength(2);
    fireEvent.click(plus[0]);
    expect(h.sock().sent).toEqual([{ t: 'addBot', level: 'easy' }]);
  });

  it('start works with one player: empty seats get bots', () => {
    const h = inLobby('s1', lobbyOf([seat('s1', 'Ana')]));
    const start = screen.getByRole('button', { name: 'Start game' });
    expect(start).toHaveProperty('disabled', false);
    fireEvent.click(start);
    expect(h.sock().sent).toEqual([{ t: 'start' }]);
  });

  it('non-host sees the settings read-only and no host controls', () => {
    inLobby('s2', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]));
    expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Bot' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Invite' }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Turn timer')).toBeNull();
    expect(screen.getByText('Bot takes over after')).toBeTruthy();
    expect(screen.getByText('Waiting for the host to start…')).toBeTruthy();
    // Only my own academy chip opens the picker.
    expect(screen.queryByRole('button', { name: 'Academy: Ana' })).toBeNull();
  });

  it('my academy chip opens a picker; picking sends setSeat, Random sends null', () => {
    const h = inLobby('s2', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob', { academyId: 'verdant' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Academy: Bob' }));
    const picker = screen.getByRole('dialog', { name: 'Choose academy' });
    fireEvent.click(within(picker).getByRole('button', { name: /Runeforge/ }));
    expect(screen.queryByRole('dialog', { name: 'Choose academy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Academy: Bob' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Random/ }));
    expect(h.sock().sent).toEqual([
      { t: 'setSeat', academyId: 'runeforge' },
      { t: 'setSeat', academyId: null },
    ]);
  });

  it('an academy another player picked is greyed "taken"', () => {
    inLobby('s2', lobbyOf([seat('s1', 'Ana', { academyId: 'pyromancy' }), seat('s2', 'Bob')]));
    fireEvent.click(screen.getByRole('button', { name: 'Academy: Bob' }));
    const taken = within(screen.getByRole('dialog')).getByRole('button', { name: /Pyromancy/ });
    expect(taken).toHaveProperty('disabled', true);
    expect(taken.textContent).toContain('taken');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Random/ })).toHaveProperty('disabled', false);
  });

  it('host removes bots and players', () => {
    const h = inLobby('s1', lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob'), seat('b1', 'Bot Ivy', { kind: 'bot', botLevel: 'normal' })]));
    expect(screen.queryByRole('button', { name: 'Academy: Bot Ivy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bot Ivy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(h.sock().sent).toEqual([
      { t: 'removeSeat', seatId: 'b1' },
      { t: 'removeSeat', seatId: 's2' },
    ]);
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
    fireEvent.click(screen.getByRole('button', { name: /Leave/ }));
    expect(h.sock().sent).toEqual([{ t: 'leave' }]);
  });

  it('Match found (Casual/Ranked) has no academy picker: academies are drawn', () => {
    inLobby('s1', { ...lobbyOf([seat('s1', 'Ana'), seat('s2', 'Bob')]), quick: true, startsAt: Date.now() + 10_000 });
    expect(screen.getByText('Match found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Academy:/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Random')).toBeNull();
  });
});
