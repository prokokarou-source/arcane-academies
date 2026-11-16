import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FriendList, LobbyState } from '@arcane/protocol';
import { harness, memoryStorage } from './fakeSocket';
import { renderApp } from './render';

afterEach(cleanup);

const list = (l: Partial<FriendList> = {}): FriendList => ({ friends: [], incoming: [], outgoing: [], ...l });
const lobby: LobbyState = {
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId: 's1',
  seats: [{ id: 's1', kind: 'human', name: 'Ana', academyId: null, side: 'A', connected: true }],
  settings: { graceMs: 60_000, turnTimerMs: null },
};

describe('account client', () => {
  it('saves the token from signup and resends it on every reconnect', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.client.signup('Ana', 'secret1');
    expect(h.client.getState().accountPending).toBe(true);
    expect(h.sock().sent).toEqual([{ t: 'signup', username: 'Ana', password: 'secret1' }]);
    h.sock().receive({ t: 'account', username: 'Ana', token: 'tok123' });
    expect(h.client.getState()).toMatchObject({ account: 'Ana', accountPending: false });
    // Only the token is stored, never the password.
    expect([...h.storage.data.values()].join()).not.toContain('secret1');

    h.sock().serverClose(1006);
    h.runTimers();
    h.sock().open();
    expect(h.sock().sent[0]).toEqual({ t: 'auth', token: 'tok123' });
  });

  it('logs in from a saved token at start, before rejoining a seat', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.account', JSON.stringify({ token: 'tok123' }));
    storage.setItem('arcane.session', JSON.stringify({ code: 'WAND-42', token: 'seat' }));
    const h = harness(storage);
    h.client.start();
    expect(h.client.getState().accountPending).toBe(true);
    h.sock().open();
    expect(h.sock().sent.map((m) => m.t)).toEqual(['auth', 'rejoin']);
  });

  it('drops a login that the server no longer knows, without touching the room', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.account', JSON.stringify({ token: 'old' }));
    const h = harness(storage);
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'error', code: 'bad_session', message: '' });
    expect(h.client.getState()).toMatchObject({ account: null, accountPending: false, error: null });
    expect(storage.data.has('arcane.account')).toBe(false);
  });

  it('keeps account errors out of the room error banner', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.client.login('Ana', 'nope');
    h.sock().receive({ t: 'error', code: 'bad_login', message: '' });
    expect(h.client.getState()).toMatchObject({ error: null, socialError: { code: 'bad_login' }, accountPending: false });
  });

  it('applies presence changes to the friend list and collects invites', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'account', username: 'Ana' });
    h.sock().receive({ t: 'friends', list: list({ friends: [{ username: 'Bob', online: false }, { username: 'Cyd', online: false }] }) });
    h.sock().receive({ t: 'presence', username: 'Cyd', online: true });
    expect(h.client.getState().friends?.friends).toEqual([
      { username: 'Cyd', online: true },
      { username: 'Bob', online: false },
    ]);
    h.sock().receive({ t: 'invite', from: 'Cyd', code: 'WAND-42' });
    h.sock().receive({ t: 'invite', from: 'Cyd', code: 'WAND-42' });
    expect(h.client.getState().invites).toEqual([{ from: 'Cyd', code: 'WAND-42' }]);

    h.sock().receive({ t: 'account', username: null });
    expect(h.client.getState()).toMatchObject({ account: null, friends: null, invites: [] });
  });
});

describe('account screens', () => {
  it('guests still see Create game; the account screen signs up', () => {
    const h = renderApp();
    expect(screen.getByRole('button', { name: 'Create game' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log in or create an account' }));
    fireEvent.click(screen.getByRole('button', { name: 'New here? Create an account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(h.sock().sent).toContainEqual({ t: 'signup', username: 'Ana', password: 'secret1' });

    act(() => h.sock().receive({ t: 'error', code: 'username_taken', message: '' }));
    expect(screen.getByRole('alert').textContent).toContain('That username is taken.');
    act(() => h.sock().receive({ t: 'account', username: 'Ana', token: 't' }));
    expect(screen.getByText('Logged in as Ana')).toBeTruthy();
  });

  it('shows friends with online status, accepts requests and adds by username', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: list({ friends: [{ username: 'Bob', online: true }], incoming: ['Cyd'], outgoing: ['Dee'] }) });
    });
    fireEvent.click(screen.getByRole('button', { name: /Friends · 1 online/ }));
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    // Invites only make sense inside a room.
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(h.sock().sent).toContainEqual({ t: 'friendAccept', username: 'Cyd' });
    fireEvent.change(screen.getByLabelText("Friend's username"), { target: { value: 'Eve_2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(h.sock().sent).toContainEqual({ t: 'friendRequest', username: 'Eve_2' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(h.sock().sent).toContainEqual({ t: 'friendRemove', username: 'Bob' });

    act(() => h.sock().receive({ t: 'error', code: 'no_user', message: '' }));
    expect(screen.getByRole('alert').textContent).toContain('No player has that username.');
  });

  it('invites an online friend from the lobby', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: list({ friends: [{ username: 'Bob', online: true }, { username: 'Cyd', online: false }] }) });
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({ t: 'lobby', lobby });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite friends' }));
    const invites = screen.getAllByRole('button', { name: 'Invite' });
    expect(invites).toHaveLength(1); // offline friends cannot be invited
    fireEvent.click(invites[0]);
    expect(h.sock().sent).toContainEqual({ t: 'invite', username: 'Bob' });
    expect(screen.getByRole('button', { name: 'Invited' })).toBeTruthy();
  });

  it('a guest lobby has no invite button', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({ t: 'lobby', lobby });
    });
    expect(screen.queryByRole('button', { name: 'Invite friends' })).toBeNull();
  });

  it('an incoming invite shows a banner whose Join enters the room', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Bob' });
      h.sock().receive({ t: 'invite', from: 'Ana', code: 'WAND-42' });
    });
    expect(screen.getByText('Ana invites you to room WAND-42')).toBeTruthy();
    const banner = screen.getByText('Ana invites you to room WAND-42').closest('.banner') as HTMLElement;
    fireEvent.click(within(banner).getByRole('button', { name: 'Join' }));
    expect(h.sock().sent).toContainEqual({ t: 'join', code: 'WAND-42', name: 'Bob' });
    expect(screen.queryByText('Ana invites you to room WAND-42')).toBeNull();
  });
});
