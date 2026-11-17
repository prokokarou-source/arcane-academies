import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LobbyState } from '@arcane/protocol';
import { harness } from './fakeSocket';
import { openMore, renderApp } from './render';

afterEach(cleanup);

const lobby: LobbyState = {
  code: 'WAND-42',
  inviteUrl: 'http://x/?room=WAND-42',
  hostId: 's1',
  seats: [
    { id: 's1', kind: 'human', name: 'Ana', academyId: null, connected: true, username: 'Ana' },
    { id: 's2', kind: 'human', name: 'Bobby', academyId: null, connected: true, username: 'Bob' },
    { id: 's3', kind: 'human', name: 'Guest', academyId: null, connected: true },
  ],
  settings: { graceMs: 60_000, turnTimerMs: null }, config: { sideMode: 'random' as const, turnTimerMs: null, seats: 7, public: false, bots: 0, botLevel: 'normal' as const }, kind: 'room' as const, 
};

describe('safety client', () => {
  it('keeps the blocked list, report confirmations and recovery codes; logout clears them', () => {
    const h = harness();
    h.client.start();
    h.sock().open();
    h.sock().receive({ t: 'account', username: 'Ana' });
    h.sock().receive({ t: 'invite', from: 'Bob', code: 'WAND-42' });
    h.sock().receive({ t: 'blocked', list: ['Bob'] });
    // An invite from someone just blocked goes away.
    expect(h.client.getState()).toMatchObject({ blocked: ['Bob'], invites: [] });
    h.client.block('Cy');
    h.client.unblock('Bob');
    h.client.report('Bob', 'name', 'rude');
    expect(h.sock().sent.slice(-3)).toEqual([
      { t: 'block', username: 'Cy' },
      { t: 'unblock', username: 'Bob' },
      { t: 'report', username: 'Bob', reason: 'name', note: 'rude' },
    ]);
    h.sock().receive({ t: 'reported', username: 'Bob' });
    h.sock().receive({ t: 'recoveryCode', code: 'ABCD-EFGH-JKMN-PQRS' });
    expect(h.client.getState()).toMatchObject({ reported: 'Bob', recoveryCode: 'ABCD-EFGH-JKMN-PQRS' });
    h.sock().receive({ t: 'account', username: null });
    expect(h.client.getState()).toMatchObject({ blocked: null, reported: null, recoveryCode: null });
  });

  it('shows the recovery code after signup until "I saved it"', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana', token: 'tok' });
      h.sock().receive({ t: 'recoveryCode', code: 'ABCD-EFGH-JKMN-PQRS' });
    });
    const dialog = screen.getByRole('dialog', { name: 'Your recovery code' });
    expect(within(dialog).getByText('ABCD-EFGH-JKMN-PQRS')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'I saved it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // The code is never stored on the device.
    expect([...h.storage.data.values()].join()).not.toContain('ABCD');
  });

  it('resets a forgotten password from the login screen', () => {
    const h = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abcd efgh jkmn pqrs' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brandnew' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(h.sock().sent).toContainEqual({ t: 'recover', username: 'Ana', code: 'abcd efgh jkmn pqrs', password: 'brandnew' });
    act(() => h.sock().receive({ t: 'error', code: 'bad_recovery', message: '' }));
    expect(screen.getByRole('alert').textContent).toContain('Wrong username or recovery code');
  });

  it('lists blocked players in Account and makes a new recovery code with the password', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'blocked', list: ['Bob'] });
    });
    openMore('Account settings');
    const list = screen.getByRole('list', { name: 'Blocked players' });
    fireEvent.click(within(list).getByRole('button', { name: 'Unblock' }));
    expect(h.sock().sent).toContainEqual({ t: 'unblock', username: 'Bob' });
    fireEvent.change(screen.getByLabelText('Recovery code: Current password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create recovery code' }));
    expect(h.sock().sent).toContainEqual({ t: 'createRecoveryCode', password: 'secret1' });
  });

  it('blocks and reports from a lobby seat, only for other logged-in players', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive({ t: 'lobby', lobby });
    });
    expect(screen.queryByRole('button', { name: 'Options for Ana' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Options for Guest/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bob' }));
    const sheet = screen.getByRole('dialog', { name: 'Options for Bob' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Block' }));
    expect(h.sock().sent).toContainEqual({ t: 'block', username: 'Bob' });
    act(() => h.sock().receive({ t: 'blocked', list: ['Bob'] }));
    expect(within(sheet).getByRole('button', { name: 'Unblock' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Report' }));
    fireEvent.change(within(sheet).getByLabelText('Reason'), { target: { value: 'harassment' } });
    fireEvent.change(within(sheet).getByLabelText('Details (optional)'), { target: { value: '  mean  ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send report' }));
    expect(h.sock().sent).toContainEqual({ t: 'report', username: 'Bob', reason: 'harassment', note: 'mean' });
    act(() => h.sock().receive({ t: 'reported', username: 'Bob' }));
    expect(within(sheet).getByRole('status').textContent).toContain('Your report about Bob was sent');
  });

  it('hides the options for guests', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's3', token: 't' });
      h.sock().receive({ t: 'lobby', lobby });
    });
    expect(screen.queryByRole('button', { name: /Options for/ })).toBeNull();
  });
});
