import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LobbyState } from '@arcane/protocol';
import { renderApp } from './render';
import { gameMsg, makeGame } from './views';

afterEach(cleanup);

const badges = (el: Element | null) => [...(el?.querySelectorAll('.avatar-badge') ?? [])];
const stroke = (svg: Element) => svg.querySelector('g')!.getAttribute('stroke');

describe('avatar picker', () => {
  it('shows my avatar, picks an emblem and a colour, and resets to the default', () => {
    const h = renderApp();
    act(() => h.sock().receive({ t: 'account', username: 'Ana', avatar: { icon: 'owl', color: 'teal' } }));
    expect(h.client.getState().avatar).toEqual({ icon: 'owl', color: 'teal' });
    fireEvent.click(screen.getByRole('button', { name: 'Logged in as Ana' }));
    expect(screen.getByRole('img', { name: 'Avatar of Ana' })).toBeTruthy();
    fireEvent.click(screen.getByText('Avatar'));
    expect(screen.getByRole('radio', { name: 'Owl' }).getAttribute('aria-checked')).toBe('true');
    h.sock().sent.length = 0;

    fireEvent.click(screen.getByRole('radio', { name: 'Comet' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Rose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use the default' }));
    expect(h.sock().sent).toEqual([
      { t: 'setAvatar', avatar: { icon: 'comet', color: 'teal' } },
      { t: 'setAvatar', avatar: { icon: 'comet', color: 'rose' } },
      { t: 'setAvatar', avatar: null },
    ]);
    expect(h.client.getState().avatar).toBeNull();
    // Colours wait for an emblem.
    expect((screen.getByRole('radio', { name: 'Gold' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('logging out forgets the avatar', () => {
    const h = renderApp();
    act(() => h.sock().receive({ t: 'account', username: 'Ana', avatar: { icon: 'key', color: 'gold' } }));
    act(() => h.sock().receive({ t: 'account', username: null }));
    expect(h.client.getState().avatar).toBeNull();
  });
});

describe('avatars next to names', () => {
  it('lobby seats: chosen avatar for accounts, neutral for guests, none for bots', () => {
    const h = renderApp();
    const lobby: LobbyState = {
      code: 'WAND-42',
      inviteUrl: 'x',
      hostId: 's1',
      settings: { graceMs: 60_000, turnTimerMs: null }, config: { sideMode: 'random' as const, turnTimerMs: null, seats: 7, public: false, bots: 0, botLevel: 'normal' as const }, kind: 'room' as const, 
      seats: [
        { id: 's1', kind: 'human', name: 'Ana', academyId: null, connected: true, avatar: { icon: 'crown', color: 'violet' } },
        { id: 's2', kind: 'human', name: 'Guest', academyId: null, connected: true },
        { id: 's3', kind: 'bot', name: 'Bot 1', botLevel: 'easy', academyId: null, connected: true },
      ],
    };
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({ t: 'lobby', lobby });
    });
    const [ana, guest, bot] = ['Ana', 'Guest', 'Bot 1'].map((n) => badges(screen.getByText(n).closest('li')));
    expect(ana).toHaveLength(1);
    expect(stroke(ana[0])).toBe('#9a6fe0');
    expect(guest[0].classList.contains('avatar-default')).toBe(true);
    expect(bot).toHaveLength(0);
  });

  it('friends list and leaderboard', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: { friends: [{ username: 'Bob', online: true, avatar: { icon: 'wave', color: 'azure' } }], incoming: [], outgoing: [] } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Friends · 1 online/ }));
    expect(stroke(badges(screen.getByText('Bob').closest('li'))[0])).toBe('#4b8fe0');
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    act(() =>
      h.sock().receive({
        t: 'leaderboard',
        queue: '1v1',
        scope: 'friends',
        rows: [
          { rank: 1, username: 'Bob', country: null, division: 'apprentice', rating: 1016, games: 1, avatar: { icon: 'wave', color: 'azure' } },
          { rank: 2, username: 'Ana', country: null, division: 'apprentice', rating: 984, games: 1 },
        ],
        me: null,
      }),
    );
    const rows = [...screen.getByRole('list', { name: 'Leaderboard' }).querySelectorAll('li')];
    expect(stroke(badges(rows[0])[0])).toBe('#4b8fe0');
    expect(badges(rows[1])[0].classList.contains('avatar-default')).toBe(true);
  });

  it('game player panels and the end screen', () => {
    const h = renderApp();
    const s = makeGame(['Ana', 'Bob', 'Cleo']);
    const g = gameMsg(s, 0);
    const seats = g.seats.map((x, i) => (i === 1 ? { ...x, avatar: { icon: 'flame' as const, color: 'ember' as const } } : x));
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({ ...g, seats });
    });
    const bob = screen.getAllByText('Bob')[0].closest('button');
    expect(stroke(badges(bob)[0])).toBe('#e0662a');
  });
});
