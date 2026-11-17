import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ACADEMIES } from '@arcane/engine';
import type { GameMsg } from '../src/net/menuTypes';
import { FAQ } from '../src/ui/More';
import { harness, memoryStorage, type FakeSocket } from './fakeSocket';
import { goTab, openMore, renderApp } from './render';

afterEach(cleanup);

/** Messages of the new contract, sent as JSON by the fake server. */
const recv = (s: FakeSocket, msg: object) => act(() => s.onmessage?.({ data: JSON.stringify(msg) }));
const nav = () => screen.getByRole('navigation', { name: 'Main menu' });
const named = (name: string) => {
  const storage = memoryStorage();
  storage.setItem('arcane.prefs', JSON.stringify({ name }));
  return storage;
};
const emptyProfile = { memberSince: 0, me: true, ranked: [], totals: { games: 0, wins: 0, totalScore: 0, bestScore: 0, streak: 0, bestStreak: 0 }, byKind: { casual: { games: 0, wins: 0 }, ranked: { games: 0, wins: 0 } }, academies: [], recent: [] };

describe('menu navigation', () => {
  it('opens on Play with a 4-slot bottom bar and switches tabs', () => {
    renderApp();
    const slots = within(nav()).getAllByRole('button').map((b) => b.textContent);
    expect(slots).toEqual(['Leaderboards', 'Rooms', 'Play', 'More']);
    expect(within(nav()).getByRole('button', { name: 'Play' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('tab', { name: 'Bots' }).getAttribute('aria-selected')).toBe('true');
    goTab('Rooms');
    expect(screen.getByRole('tab', { name: 'Open Rooms' })).toBeTruthy();
    goTab('Leaderboards');
    expect(screen.getByRole('tab', { name: '1v1' })).toBeTruthy();
    goTab('More');
    expect(screen.getByRole('region', { name: 'Game' })).toBeTruthy();
  });

  it('guests see Guest + Log in; logged-in players their name; the bell lists invites and requests', () => {
    const h = renderApp();
    expect(screen.getByText('Guest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: { friends: [], incoming: ['Cyd'], outgoing: [] } });
      h.sock().receive({ t: 'invite', from: 'Bob', code: 'WAND-42' });
    });
    expect(screen.queryByText('Guest')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications (2 new)' }));
    const sheet = screen.getByRole('dialog', { name: 'Notifications' });
    expect(within(sheet).getByText('Cyd wants to be your friend')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Accept' }));
    expect(h.sock().sent).toContainEqual({ t: 'friendAccept', username: 'Cyd' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Join' }));
    expect(h.sock().sent).toContainEqual({ t: 'join', code: 'WAND-42', name: 'Ana' });
  });
});

describe('Play tab', () => {
  it('Bots: picks 4 opponents and Hard, starts offline with the side + academy draw', () => {
    const h = renderApp();
    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(h.sockets.every((s) => s.sent.length === 0)).toBe(true);
    const g = h.client.getState().game!;
    expect(g.seats).toHaveLength(5);
    expect(g.seats[0].name).toMatch(/^Guest\d{4}$/);
    const draw = screen.getByRole('dialog', { name: 'The draw' });
    expect(within(draw).getByText(/Side [AB] for every academy/)).toBeTruthy();
    expect(within(draw).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(draw);
    expect(screen.queryByRole('dialog', { name: 'The draw' })).toBeNull();
    expect(screen.getByText('Term I')).toBeTruthy();
  });

  it('with Animations off the draw is skipped', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.prefs', JSON.stringify({ name: 'Ana', animations: false }));
    const h = renderApp({ storage });
    expect(document.documentElement.classList.contains('no-anim')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(screen.queryByRole('dialog', { name: 'The draw' })).toBeNull();
    expect(h.client.getState().reveal).toBeNull();
    expect(screen.getByText('Term I')).toBeTruthy();
  });

  it('Casual: joins the chosen queue, shows the waiting screen and cancels', () => {
    const h = renderApp({ storage: named('Ana') });
    fireEvent.click(screen.getByRole('tab', { name: 'Casual' }));
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      expect.stringContaining('1v1'),
      expect.stringContaining('3–5 players'),
      expect.stringContaining('6–7 players'),
    ]);
    fireEvent.click(screen.getByRole('radio', { name: /6–7 players/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(h.sock().sent).toEqual([{ t: 'queueJoin', kind: 'casual', queue: '6-7', name: 'Ana' }]);
    expect(screen.getByRole('heading', { name: 'Casual · 6–7 players' })).toBeTruthy();
    recv(h.sock(), { t: 'queueState', kind: 'casual', queue: '6-7', searching: 4, waitedMs: 0 });
    expect(screen.getByText('Players searching: 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'queueLeave' });
    expect(screen.getByRole('button', { name: 'Start Game' })).toBeTruthy();
  });

  it('Ranked needs an account; logged in it joins the ranked queue and shows my rating', () => {
    const h = renderApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Ranked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log in to play Ranked' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();
    act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(h.sock().sent).toContainEqual({ t: 'profile' });
    recv(h.sock(), {
      t: 'profile',
      profile: { ...emptyProfile, username: 'Ana', country: null, ranked: [{ queue: '1v1', rating: 1510, division: 'archmage', rank: 1, countryRank: null }] },
    });
    const card = screen.getByRole('radio', { name: /1v1/ });
    expect(card.textContent).toContain('1510');
    expect(within(card).getByRole('img', { name: 'Archmage' })).toBeTruthy();
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'queueJoin', kind: 'ranked', queue: '1v1', name: 'Ana' });
  });
});

describe('Rooms tab', () => {
  const rooms = [
    { code: 'WAND-42', host: 'Bob', sideMode: 'random', turnTimerMs: 60_000, seats: 5, taken: 2, bots: 1 },
    { code: 'MOON-17', host: 'Cyd', sideMode: 'A', turnTimerMs: null, seats: 3, taken: 1, bots: 0 },
  ];

  it('watches the public list while open; tapping a row joins it', () => {
    const h = renderApp({ storage: named('Ana') });
    goTab('Rooms');
    expect(h.sock().sent).toEqual([{ t: 'roomsWatch' }]);
    expect(screen.getByText('Looking for open rooms…')).toBeTruthy();
    recv(h.sock(), { t: 'rooms', rooms });
    const row = screen.getByRole('row', { name: "Join Bob's room (2 free)" });
    expect(row.textContent).toContain('?');
    expect(row.textContent).toContain('1 min');
    expect(row.querySelectorAll('.seat-icons > span')).toHaveLength(5);
    expect(screen.getByRole('row', { name: "Join Cyd's room (2 free)" }).textContent).toContain('Off');
    fireEvent.click(row);
    expect(h.sock().sent.at(-1)).toEqual({ t: 'join', code: 'WAND-42', name: 'Ana' });
    goTab('Play');
    expect(h.sock().sent.at(-1)).toEqual({ t: 'roomsUnwatch' });
    expect(h.client.getState().rooms).toBeNull();
  });

  it('Spectate says coming soon; Join Room takes a code (prefilled from an invite link)', () => {
    const h = renderApp({ storage: named('Ana'), initialRoom: 'wand-42' });
    recv(h.sock(), { t: 'rooms', rooms: [] });
    expect(screen.getByText('No open rooms right now. Create one!')).toBeTruthy();
    const sheet = screen.getByRole('dialog', { name: 'Join Room' });
    expect(within(sheet).getByLabelText('Room code')).toHaveProperty('value', 'WAND-42');
    fireEvent.change(within(sheet).getByLabelText('Room code'), { target: { value: 'moon-17' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Join' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'join', code: 'MOON-17', name: 'Ana' });
    fireEvent.click(screen.getByRole('tab', { name: 'Spectate' }));
    expect(screen.getByText('Spectating is coming soon.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Open Rooms' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Create Room: settings first, then the lobby', () => {
    const h = renderApp({ storage: named('Ana') });
    goTab('Rooms');
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    expect(screen.getByRole('heading', { name: 'Create Room' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Side B' }));
    fireEvent.change(screen.getByLabelText('Turn timer'), { target: { value: '90000' } });
    fireEvent.click(screen.getByRole('button', { name: 'More Seats' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Seats' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Bots' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Bots' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Easy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    expect(h.sock().sent.at(-1)).toEqual({
      t: 'createRoom',
      name: 'Ana',
      settings: { sideMode: 'B', turnTimerMs: 90000, seats: 6, public: false, bots: 2, botLevel: 'easy' },
    });
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({
        t: 'lobby',
        lobby: {
          code: 'WAND-42',
          inviteUrl: '',
          hostId: 's1',
          settings: { graceMs: 60_000, turnTimerMs: 90_000 },
          seats: [{ id: 's1', kind: 'human', name: 'Ana', academyId: null, side: 'A', connected: true }],
          config: { sideMode: 'B', turnTimerMs: 90000, seats: 6, public: false, bots: 2, botLevel: 'easy' },
        } as never,
      });
    });
    expect(screen.getByText('WAND-42')).toBeTruthy();
    expect(screen.getByLabelText('Room settings').textContent).toContain('Private');
    // Leaving the lobby returns to the menu, not the settings page.
    act(() => h.sock().receive({ t: 'closed', reason: 'left' }));
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeTruthy();
  });
});

describe('Leaderboards tab', () => {
  const row = (rank: number | null, username: string, rating: number | null, country: string | null = null) => ({
    rank,
    username,
    country,
    division: rating && rating >= 1300 ? 'magister' : 'apprentice',
    rating,
    games: 3,
  });

  it('asks per queue and scope, shows the table with my row pinned, opens profiles and plays the queue', () => {
    const h = renderApp();
    act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
    goTab('Leaderboards');
    expect(h.sock().sent).toContainEqual({ t: 'leaderboard', queue: '3-5', scope: 'global' });
    recv(h.sock(), { t: 'profile', profile: { ...emptyProfile, username: 'Ana', country: 'GR' } });
    expect(screen.getAllByRole('radio').map((c) => c.textContent)).toEqual(['Friends', 'Global', 'Europe', 'Greece']);
    recv(h.sock(), { t: 'leaderboard', queue: '3-5', scope: 'global', rows: [row(1, 'Zed', 1420, 'CY'), row(2, 'Bob', 1050)], me: row(null, 'Ana', null, 'GR') });
    const table = screen.getByRole('table', { name: 'Leaderboard' });
    const [head, ...rows] = within(table).getAllByRole('row');
    expect(head.textContent).toBe('RankPlayerDivisionRating');
    expect(rows[0].textContent).toContain('1420');
    expect(within(rows[0]).getByRole('img', { name: 'Cyprus' })).toBeTruthy();
    expect(within(rows[0]).getByRole('img', { name: 'Magister' })).toBeTruthy();
    const mine = table.querySelector('tfoot tr') as HTMLElement;
    expect(mine.textContent).toContain('Ana (You)');
    expect(mine.textContent).toContain('N/A');
    expect(mine.textContent).toContain('–');

    fireEvent.click(screen.getByRole('radio', { name: 'Greece' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'leaderboard', queue: '3-5', scope: 'country' });
    fireEvent.click(screen.getByRole('tab', { name: '1v1' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'leaderboard', queue: '1v1', scope: 'country' });
    fireEvent.click(screen.getByRole('button', { name: 'Search players' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search players' }), { target: { value: 'ze' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'leaderboard', queue: '1v1', scope: 'country', search: 'ze' });

    recv(h.sock(), { t: 'leaderboard', queue: '1v1', scope: 'country', rows: [row(1, 'Zed', 1420, 'CY')], me: null });
    fireEvent.click(screen.getByRole('button', { name: "Zed's profile" }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'profile', username: 'Zed' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    fireEvent.click(screen.getByRole('button', { name: 'Play 1v1' }));
    expect(h.sock().sent.at(-1)).toEqual({ t: 'queueJoin', kind: 'ranked', queue: '1v1', name: 'Ana' });
    expect(screen.getByRole('heading', { name: 'Ranked · 1v1' })).toBeTruthy();
  });

  it('guests see the global board only and are asked to log in to play', () => {
    const h = renderApp();
    goTab('Leaderboards');
    expect(screen.getAllByRole('radio').map((c) => c.textContent)).toEqual(['Global']);
    expect(screen.getByText(/Log in to get a rating/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play 3–5 players' }));
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();
    expect(h.sock().sent.some((m) => (m as { t: string }).t === 'queueJoin')).toBe(false);
  });
});

describe('More tab', () => {
  const rows = (region: string) => within(screen.getByRole('region', { name: region })).getAllByRole('button').map((b) => b.textContent);

  it('groups Account, Game and About; guests get Log in instead of account rows', () => {
    const h = renderApp();
    goTab('More');
    expect(rows('Account')).toEqual(['Log in or create an account', 'Friends']);
    expect(rows('Game')).toEqual([expect.stringMatching(/^What's new ?v/), 'LanguageEnglish', 'Rules', 'FAQ', 'Settings']);
    const about = screen.getByRole('region', { name: 'About' });
    expect(within(about).getByRole('link', { name: 'Feedback' }).getAttribute('href')).toMatch(/github\.com\/.+\/issues$/);
    act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
    expect(rows('Account')).toEqual(['Profile & stats', 'Friends', 'Account settings', 'Log out']);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(h.sock().sent).toContainEqual({ t: 'logout' });
  });

  it("What's new, FAQ, About, Language and Rules open and come back", () => {
    renderApp();
    goTab('More');
    fireEvent.click(screen.getByRole('button', { name: /What's new/ }));
    expect(screen.getByRole('heading', { name: `v${__APP_VERSION__}` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'FAQ' }));
    expect(FAQ.length).toBeGreaterThanOrEqual(8);
    expect(FAQ.length).toBeLessThanOrEqual(10);
    expect(screen.getByText(FAQ[0].q)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'About the game' }));
    expect(screen.getByText(/card-drafting game for 2–7 players/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: /^Language/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ελληνικά' }));
    fireEvent.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(screen.getByRole('button', { name: /Γλώσσα.*Ελληνικά/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Κανόνες' }));
    expect(screen.getByText('3. How a turn works')).toBeTruthy();
  });
});

describe('offline solo host', () => {
  it('draws one side for the table and distinct academies, announced once in the first message', () => {
    const h = harness();
    h.client.start();
    h.client.solo('Ana', 6, 'easy');
    const s = h.client.getState();
    expect((s.game as GameMsg).reveal).toBeDefined();
    const reveal = s.reveal!;
    expect(reveal.academies).toHaveLength(7);
    expect(new Set(reveal.academies.map((a) => a.academyId)).size).toBe(7);
    expect(reveal.academies.every((a) => ACADEMIES.some((x) => x.id === a.academyId))).toBe(true);
    // Later messages of the same game carry no new draw.
    h.client.clearReveal();
    h.runTimers();
    expect((h.client.getState().game as GameMsg).reveal).toBeUndefined();
    expect(h.client.getState().reveal).toBeNull();
    // Play again draws anew.
    h.client.playAgain(true);
    expect(h.client.getState().reveal).not.toBeNull();
  });
});
