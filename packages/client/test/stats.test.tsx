import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../src/net/menuTypes';
import { harness, type FakeSocket } from './fakeSocket';
import { openMore, renderApp } from './render';

afterEach(cleanup);

const profile: Profile = {
  username: 'Ana',
  country: 'GR',
  memberSince: Date.UTC(2026, 9, 1),
  me: true,
  ranked: [
    { queue: '1v1', rating: 1320, division: 'magister', rank: 4, countryRank: 1 },
    { queue: '3-5', rating: null, division: 'apprentice', rank: null, countryRank: null },
  ],
  totals: { games: 4, wins: 1, totalScore: 170, bestScore: 52, streak: 1, bestStreak: 2 },
  byKind: { casual: { games: 3, wins: 0 }, ranked: { games: 1, wins: 1 } },
  academies: [
    { academyId: 'pyromancy', games: 3, wins: 1 },
    { academyId: 'verdant', games: 1, wins: 0 },
  ],
  recent: [{ at: Date.UTC(2026, 10, 15), kind: 'ranked', queue: '1v1', academyId: 'pyromancy', side: 'B', score: 52, place: 1, players: 3, ratingDelta: 16 }],
};

/** What the fake server would send back, as JSON (the new messages are not in the old protocol types). */
const recv = (s: FakeSocket, msg: object) => s.onmessage?.({ data: JSON.stringify(msg) });

/** Log in and open Account settings from More. */
function accountScreen() {
  const h = renderApp();
  act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
  openMore('Account settings');
  return h;
}

describe('stats client', () => {
  it('stores profile, leaderboard and password confirmations; logout clears them', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'account', username: 'Ana' });
    h.client.requestProfile();
    h.client.requestProfile('Bob');
    h.client.requestLeaderboard('1v1', 'global', '  bo ');
    h.client.setCountry('GR');
    expect(h.sock().sent).toEqual([
      { t: 'profile' },
      { t: 'profile', username: 'Bob' },
      { t: 'leaderboard', queue: '1v1', scope: 'global', search: 'bo' },
      { t: 'setCountry', country: 'GR' },
    ]);
    recv(h.sock(), { t: 'profile', profile });
    recv(h.sock(), { t: 'leaderboard', queue: '1v1', scope: 'global', rows: [], me: null });
    h.client.changePassword('secret1', 'secret2');
    expect(h.client.getState().accountPending).toBe(true);
    h.sock().receive({ t: 'passwordChanged' });
    expect(h.client.getState()).toMatchObject({ profile, passwordChanged: true, accountPending: false });
    expect(h.client.getState().leaderboard).toMatchObject({ queue: '1v1', scope: 'global', rows: [] });

    h.client.logoutAll();
    h.client.deleteAccount('secret2');
    expect(h.sock().sent.slice(-2)).toEqual([{ t: 'logoutAll' }, { t: 'deleteAccount', password: 'secret2' }]);
    h.sock().receive({ t: 'account', username: null });
    expect(h.client.getState()).toMatchObject({ profile: null, leaderboard: null, passwordChanged: false });
  });

  it('wrong passwords show as account errors', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.client.deleteAccount('nope!!');
    h.sock().receive({ t: 'error', code: 'wrong_password', message: '' });
    expect(h.client.getState()).toMatchObject({ error: null, socialError: { code: 'wrong_password' }, accountPending: false });
  });
});

describe('profile screen', () => {
  it('opens my profile from the header with ranked tiles, totals, academies and the last games', () => {
    const h = renderApp();
    act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open my profile' }));
    expect(h.sock().sent).toContainEqual({ t: 'profile' });
    expect(screen.getByText('Loading…')).toBeTruthy();
    act(() => recv(h.sock(), { t: 'profile', profile }));
    expect(screen.getByRole('img', { name: 'Greece' })).toBeTruthy();
    const tile = screen.getByLabelText('Ranked 1v1');
    expect(tile.textContent).toContain('1320');
    expect(within(tile).getByRole('img', { name: 'Magister' })).toBeTruthy();
    expect(screen.getByLabelText('Ranked 3–5 players').textContent).toContain('N/A');
    const totals = screen.getByLabelText('Totals');
    expect(totals.textContent).toContain('25%');
    expect(totals.textContent).toContain('42.5');
    expect(totals.textContent).toContain('1 / 2');
    const academies = screen.getByRole('list', { name: 'Academies' });
    expect(within(academies).getByText('Favourite').closest('li')!.textContent).toContain('Pyromancy');
    const games = screen.getByRole('list', { name: 'Last games' });
    expect(games.textContent).toContain('Ranked · 1v1');
    expect(games.textContent).toContain('Side B');
    expect(games.textContent).toContain('+16');
    // Mine: editable avatar and country.
    fireEvent.click(screen.getByText('Edit profile'));
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'CY' } });
    expect(h.sock().sent).toContainEqual({ t: 'setCountry', country: 'CY' });
  });

  it("another player's profile is read-only, opened from the friend list", () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: { friends: [{ username: 'Bob', online: true }], incoming: [], outgoing: [] } });
    });
    openMore('Friends');
    fireEvent.click(screen.getByRole('button', { name: "Bob's profile" }));
    expect(h.sock().sent).toContainEqual({ t: 'profile', username: 'Bob' });
    act(() => recv(h.sock(), { t: 'profile', profile: { ...profile, username: 'Cyd', me: false } }));
    // Still waiting for Bob's.
    expect(screen.getByText('Loading…')).toBeTruthy();
    act(() => recv(h.sock(), { t: 'profile', profile: { ...profile, username: 'Bob', me: false, recent: [] } }));
    expect(screen.queryByText('Edit profile')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add friend' })).toBeNull(); // already a friend
    expect(screen.getByRole('button', { name: 'Options for Bob' })).toBeTruthy();
    expect(screen.getAllByText(/No games yet/).length).toBeGreaterThan(0);
  });
});

describe('managing the account', () => {
  it('account settings hold the country picker', () => {
    const h = accountScreen();
    act(() => recv(h.sock(), { t: 'profile', profile }));
    expect((screen.getByLabelText('Country') as HTMLSelectElement).value).toBe('GR');
  });

  it('changes the password with the current one', () => {
    const h = accountScreen();
    const change = screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: '123' } });
    expect(change.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'secret2' } });
    fireEvent.click(change);
    expect(h.sock().sent).toContainEqual({ t: 'changePassword', current: 'secret1', next: 'secret2' });
    act(() => h.sock().receive({ t: 'error', code: 'wrong_password', message: '' }));
    expect(screen.getByRole('alert').textContent).toContain('Wrong password.');
    act(() => h.sock().receive({ t: 'passwordChanged' }));
    expect(screen.getByRole('status').textContent).toContain('Password changed');
  });

  it('logs out everywhere', () => {
    const h = accountScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Log out on all devices' }));
    expect(h.sock().sent).toContainEqual({ t: 'logoutAll' });
  });

  it('deletes the account only after a second step with the password', () => {
    const h = accountScreen();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const del = screen.getByRole('button', { name: 'Delete forever' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(del);
    expect(h.sock().sent).toContainEqual({ t: 'deleteAccount', password: 'secret1' });
    act(() => h.sock().receive({ t: 'account', username: null }));
    expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
  });
});
