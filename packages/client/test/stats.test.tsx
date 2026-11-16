import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '@arcane/protocol';
import { harness } from './fakeSocket';
import { renderApp } from './render';

afterEach(cleanup);

const profile: Profile = {
  username: 'Ana',
  games: 4,
  wins: 1,
  totalScore: 170,
  bestScore: 52,
  recent: [{ at: Date.UTC(2026, 10, 15), academyId: 'nope', score: 52, place: 1, won: true, players: 3 }],
};

/** Log in and open the Account screen. */
function accountScreen() {
  const h = renderApp();
  act(() => h.sock().receive({ t: 'account', username: 'Ana' }));
  fireEvent.click(screen.getByRole('button', { name: /Account|Ana/ }));
  return h;
}

describe('stats client', () => {
  it('stores profile, leaderboard and password confirmations; logout clears them', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'account', username: 'Ana' });
    h.client.requestProfile();
    h.client.requestLeaderboard();
    expect(h.sock().sent).toEqual([{ t: 'profile' }, { t: 'leaderboard' }]);
    h.sock().receive({ t: 'profile', profile });
    h.sock().receive({ t: 'leaderboard', rows: [{ username: 'Ana', games: 4, wins: 1, me: true }] });
    h.client.changePassword('secret1', 'secret2');
    expect(h.client.getState().accountPending).toBe(true);
    h.sock().receive({ t: 'passwordChanged' });
    expect(h.client.getState()).toMatchObject({ profile, passwordChanged: true, accountPending: false });
    expect(h.client.getState().leaderboard).toHaveLength(1);

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
  it('asks for the profile and shows totals and the last games', () => {
    const h = accountScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(h.sock().sent).toContainEqual({ t: 'profile' });
    expect(screen.getByText('Loading…')).toBeTruthy();
    act(() => h.sock().receive({ t: 'profile', profile }));
    const stats = screen.getByLabelText('Profile');
    expect(stats.textContent).toContain('25%');
    expect(stats.textContent).toContain('42.5');
    expect(stats.textContent).toContain('52');
    const games = screen.getByRole('list', { name: 'Last games' });
    expect(games.textContent).toContain('1 of 3');
    expect(games.textContent).toContain('52 pts');
    expect(within(games).getByText('Win')).toBeTruthy();
  });

  it('says so when there are no games yet', () => {
    const h = accountScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    act(() => h.sock().receive({ t: 'profile', profile: { ...profile, games: 0, wins: 0, totalScore: 0, bestScore: 0, recent: [] } }));
    expect(screen.getByText(/No games yet/)).toBeTruthy();
  });
});

describe('leaderboard tab', () => {
  it('ranks me and my friends', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: { friends: [{ username: 'Bob', online: true }], incoming: [], outgoing: [] } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Friends · 1 online/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    expect(h.sock().sent).toContainEqual({ t: 'leaderboard' });
    act(() =>
      h.sock().receive({
        t: 'leaderboard',
        rows: [
          { username: 'Bob', games: 2, wins: 2, me: false },
          { username: 'Ana', games: 4, wins: 1, me: true },
        ],
      }),
    );
    const items = within(screen.getByRole('list', { name: 'Leaderboard' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^1Bob.*Wins: 2.*100%/),
      expect.stringMatching(/^2Ana \(You\).*Wins: 1.*25%/),
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Friend list' }));
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeTruthy();
  });
});

describe('managing the account', () => {
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
