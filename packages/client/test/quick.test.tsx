import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LobbyState } from '@arcane/protocol';
import { harness } from './fakeSocket';
import { renderApp } from './render';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const typeName = (v: string) => fireEvent.change(screen.getByLabelText('Your name'), { target: { value: v } });

const quickLobby = (startsAt: number | null): LobbyState => ({
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId: 's1',
  settings: { graceMs: 60_000, turnTimerMs: null },
  quick: true,
  startsAt,
  seats: [
    { id: 's1', kind: 'human', name: 'Ana', academyId: null, side: 'A', connected: true },
    { id: 's2', kind: 'human', name: 'Bob', academyId: null, side: 'A', connected: true },
  ],
});

describe('quick match client', () => {
  it('sends the search, keeps it across a reconnect and clears it once seated', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.client.quickMatch('Ana', 3);
    expect(h.sock().sent).toEqual([{ t: 'quickMatch', name: 'Ana', size: 3 }]);
    h.sock().receive({ t: 'quickQueue', size: 3, searching: 2, waitedMs: 0 });
    expect(h.client.getState().quick).toMatchObject({ size: 3, searching: 2 });
    h.sock().serverClose(1006);
    h.runTimers();
    h.sock().open();
    expect(h.sock().sent).toEqual([{ t: 'quickMatch', name: 'Ana', size: 3 }]);
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    expect(h.client.getState().quick).toBeNull();
  });

  it('cancel stops the search; quickBots asks the server', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.client.quickMatch('Ana', null);
    h.client.quickBots();
    h.client.quickCancel();
    expect(h.sock().sent.map((m) => m.t)).toEqual(['quickMatch', 'quickBots', 'quickCancel']);
    expect(h.client.getState().quick).toBeNull();
    // A late queue update after cancelling is ignored.
    h.sock().receive({ t: 'quickQueue', size: null, searching: 1, waitedMs: 0 });
    expect(h.client.getState().quick).toBeNull();
  });

  it('Home starts a search with the chosen size and shows the waiting screen', () => {
    const h = renderApp();
    typeName('Ana');
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quick match' }));
    expect(h.sock().sent).toEqual([{ t: 'quickMatch', name: 'Ana', size: 2 }]);
    act(() => h.sock().receive({ t: 'quickQueue', size: 2, searching: 3, waitedMs: 0 }));
    expect(screen.getByText('Looking for players…')).toBeTruthy();
    expect(screen.getByText('Players searching: 3')).toBeTruthy();
    expect(screen.getByText('Waiting 0:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'quickCancel' });
    expect(screen.getByRole('button', { name: 'Quick match' })).toBeTruthy();
  });

  it('after a minute alone offers bots or keep waiting', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const h = renderApp();
    typeName('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Quick match' }));
    expect(h.sock().sent).toEqual([{ t: 'quickMatch', name: 'Ana', size: null }]);
    expect(screen.queryByRole('button', { name: 'Play with bots instead' })).toBeNull();
    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByText('Waiting 1:01')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play with bots instead' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'quickBots' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('button', { name: 'Play with bots instead' })).toBeNull();
  });

  it('the quick lobby counts down, hides the code and the host controls', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({ t: 'lobby', lobby: quickLobby(Date.now() + 10_000) });
    });
    expect(screen.getByText('The game starts in 10 s')).toBeTruthy();
    expect(screen.queryByText('WAND-42')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Bob' })).toBeNull();
    expect(screen.getByLabelText('Academy: Ana')).toBeTruthy();
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByText('The game starts in 6 s')).toBeTruthy();
  });
});
