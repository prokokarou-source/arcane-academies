import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WIDE_QUERY } from '../src/ui/layout';
import { renderApp } from './render';
import { gameMsg, makeGame } from './views';

/** A fake matchMedia whose width can change while the app is open. */
function fakeWindow(width: number) {
  const listeners = new Set<() => void>();
  const state = { width };
  const mql = {
    get matches() {
      return state.width >= 1024;
    },
    media: WIDE_QUERY,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const other = { matches: false, addEventListener() {}, removeEventListener() {} };
  window.matchMedia = ((q: string) => (q === WIDE_QUERY ? mql : other)) as unknown as typeof window.matchMedia;
  return {
    resize(w: number) {
      state.width = w;
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

const original = window.matchMedia;
beforeEach(() => {
  window.matchMedia = original;
});
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

const nav = () => screen.getByRole('navigation', { name: 'Main menu' });

describe('laptop layout', () => {
  it('switches between the phone bottom bar and the 3-column menu at 1024px', () => {
    const win = fakeWindow(390);
    renderApp();
    expect(document.querySelector('.bottom-bar')).toBeTruthy();
    expect(document.querySelector('.desk')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start Game' })).toBeTruthy();

    win.resize(1280);
    expect(document.querySelector('.bottom-bar')).toBeNull();
    expect(document.querySelector('.menu-head')).toBeNull();
    expect(nav().classList.contains('side-nav')).toBe(true);
    expect(within(nav()).getByRole('button', { name: 'Play' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('complementary', { name: 'Friends online' })).toBeTruthy();

    // Casual and Ranked say "Find match"; the sidebar switches the middle column.
    fireEvent.click(screen.getByRole('tab', { name: 'Casual' }));
    expect(screen.getByRole('button', { name: 'Find match' })).toBeTruthy();
    fireEvent.click(within(nav()).getByRole('button', { name: 'Rooms' }));
    expect(screen.getByRole('tab', { name: 'Open Rooms' })).toBeTruthy();

    win.resize(800);
    expect(document.querySelector('.desk')).toBeNull();
    expect(document.querySelector('.bottom-bar')).toBeTruthy();
  });

  it('lists online friends on the right with Invite friend', () => {
    fakeWindow(1440);
    const h = renderApp();
    act(() => {
      h.sock().receive({ t: 'account', username: 'Ana' });
      h.sock().receive({ t: 'friends', list: { friends: [{ username: 'Bob', online: true }, { username: 'Cyd', online: false }], incoming: [], outgoing: [] } });
    });
    const rail = screen.getByRole('complementary', { name: 'Friends online' });
    expect(within(rail).getByText('Bob')).toBeTruthy();
    expect(within(rail).queryByText('Cyd')).toBeNull();
    fireEvent.click(within(rail).getByRole('button', { name: '+ Invite friend' }));
    expect(screen.getByRole('heading', { name: 'Friends' })).toBeTruthy();
  });

  it('in a game: every opponent in a row and a side panel for the selected player', () => {
    fakeWindow(1280);
    const h = renderApp();
    const s = makeGame(['Ana', 'Bob', 'Cleo', 'Dax']);
    act(() => {
      h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
      h.sock().receive(gameMsg(s, 0));
    });
    const row = screen.getByRole('region', { name: 'Opponents' });
    expect(within(row).getAllByRole('button')).toHaveLength(3);
    const panel = screen.getByRole('complementary', { name: 'Selected player' });
    expect(within(panel).getByRole('heading', { name: /Ana/ })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: /Cleo/ }));
    expect(within(panel).getByRole('heading', { name: /Cleo/ })).toBeTruthy();
    // No sheet opens on a laptop: the panel shows the player instead.
    expect(screen.queryByRole('dialog', { name: 'Cleo' })).toBeNull();
    expect(document.querySelector('.table-btn')).toBeNull();
    expect(screen.getAllByTestId('card')).toHaveLength(7);
  });
});
