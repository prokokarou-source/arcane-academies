import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryStorage } from './fakeSocket';
import { renderApp } from './render';

afterEach(cleanup);

const typeName = (v: string) => fireEvent.change(screen.getByLabelText('Your name'), { target: { value: v } });

describe('Home', () => {
  it('create sends the trimmed name', () => {
    const h = renderApp();
    typeName('  Ana  ');
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    expect(h.sock().sent).toEqual([{ t: 'create', name: 'Ana' }]);
  });

  it('join uppercases the code and prefills it from initialRoom', () => {
    const h = renderApp({ initialRoom: 'wand-42' });
    expect(screen.getByLabelText('Room code')).toHaveProperty('value', 'WAND-42');
    typeName('Bob');
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'moon-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(h.sock().sent).toEqual([{ t: 'join', code: 'MOON-17', name: 'Bob' }]);
  });

  it('solo sends create', () => {
    const h = renderApp();
    typeName('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Play solo' }));
    expect(h.sock().sent).toEqual([{ t: 'create', name: 'Ana' }]);
  });

  it('buttons disabled without a name', () => {
    renderApp();
    for (const name of ['Create game', 'Join', 'Play solo']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    }
  });

  it('remembers the name', () => {
    const storage = memoryStorage();
    renderApp({ storage });
    typeName('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    cleanup();
    renderApp({ storage });
    expect(screen.getByLabelText('Your name')).toHaveProperty('value', 'Ana');
  });

  it('shows the notice when the seat was replaced', () => {
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().serverClose(4001);
    });
    expect(screen.getByText('Your seat was opened on another device.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Your seat was opened on another device.')).toBeNull();
  });

  it('shows the reconnecting bar', () => {
    const h = renderApp();
    act(() => h.sock().serverClose(1006));
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
  });

  it('settings saves name and language and falls back to English', () => {
    const storage = memoryStorage();
    renderApp({ storage });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Zoe' } });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'el' } });
    expect(JSON.parse(storage.data.get('arcane.prefs')!)).toMatchObject({ name: 'Zoe', lang: 'el' });
    fireEvent.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(screen.getByRole('button', { name: 'Νέο παιχνίδι' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play solo' })).toBeTruthy();
  });

  it('opens the rules', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.getByText('3. How a turn works')).toBeTruthy();
    expect(screen.getByText(/Terms I and III pass to the/)).toBeTruthy();
    expect(screen.getByText(/Pyromancy Academy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Create game' })).toBeTruthy();
  });
  it('shows Connecting while a stored game is being restored, then Home if it is gone', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.session', JSON.stringify({ code: 'WAND-42', token: 'tok' }));
    const h = renderApp({ storage });
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create game' })).toBeNull();
    act(() => h.sock().receive({ t: 'error', code: 'no_room', message: 'x' }));
    expect(screen.getByRole('button', { name: 'Create game' })).toBeTruthy();
  });

  it('explains server errors in its own words', () => {
    const h = renderApp();
    act(() => h.sock().receive({ t: 'error', code: 'room_full', message: 'raw server text' }));
    expect(screen.getByText('That room is full (7 seats).')).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
  });
});
