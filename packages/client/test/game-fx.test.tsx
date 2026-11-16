import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cardDef, viewFor, type GameState } from '@arcane/engine';
import { passDirection } from '../src/game/derive';
import { memoryStorage } from './fakeSocket';
import { renderApp } from './render';
import { gameMsg, makeGame, type GameMsg } from './views';

afterEach(cleanup);

function inGame(msg: GameMsg, storage = memoryStorage()) {
  const h = renderApp({ storage });
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.sock().receive(msg);
  });
  return h;
}

/** A copy of the game where the given seats have built the first card of their hand. */
function withBuilt(s: GameState, seats: number[]): GameState {
  const next = structuredClone(s);
  for (const seat of seats) next.players[seat].built.push(next.players[seat].hand.shift()!);
  return next;
}

const s = makeGame(['Ana', 'Bob', 'Cleo']);

describe('pass direction', () => {
  it('follows the engine: Terms I and III pass left, Term II passes right', () => {
    expect(passDirection(viewFor({ ...s, term: 1 }, 0))).toEqual({ to: 2, from: 1, side: 'left' });
    expect(passDirection(viewFor({ ...s, term: 2 }, 0))).toEqual({ to: 1, from: 2, side: 'right' });
    expect(passDirection(viewFor({ ...s, term: 3 }, 0))).toEqual({ to: 2, from: 1, side: 'left' });
    expect(passDirection(viewFor({ ...s, term: 2 }, 2)).to).toBe(0);
  });

  it('shows who gets my hand, on the arrow and on the neighbour panels', () => {
    inGame(gameMsg(s, 0));
    const arrow = document.querySelector('.pass-arrow')!;
    expect(arrow.textContent).toContain('Cards pass to Cleo');
    expect(arrow.getAttribute('data-side')).toBe('left');
    const [left, right] = [...document.querySelectorAll('.neighbors .neighbor')];
    expect(left.querySelector('[data-pass]')!.getAttribute('data-pass')).toBe('gets');
    expect(right.querySelector('[data-pass]')!.getAttribute('data-pass')).toBe('gives');
  });

  it('flips to the right neighbour in Term II', () => {
    inGame(gameMsg({ ...s, term: 2 }, 0));
    const arrow = document.querySelector('.pass-arrow')!;
    expect(arrow.textContent).toContain('Cards pass to Bob');
    expect(arrow.getAttribute('data-side')).toBe('right');
    expect(screen.getByText('gets your hand').closest('.neighbor')!.textContent).toContain('Bob');
  });
});

describe('built cards', () => {
  const built = withBuilt(s, [0, 1, 2]);
  const nameOf = (seat: number) => cardDef(built.players[seat].built[0].defId).name;

  it('my own built card opens its card info', () => {
    inGame(gameMsg(built, 0));
    const mine = screen.getByRole('list', { name: 'Built cards of Ana' });
    fireEvent.click(within(mine).getByRole('button', { name: `About ${nameOf(0)}` }));
    expect(screen.getByRole('dialog', { name: nameOf(0) })).toBeTruthy();
  });

  it("a neighbour's built card opens its card info", () => {
    inGame(gameMsg(built, 0));
    const bob = screen.getByRole('list', { name: 'Built cards of Bob' });
    fireEvent.click(within(bob).getByRole('button', { name: `About ${nameOf(1)}` }));
    expect(screen.getByRole('dialog', { name: nameOf(1) })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Bob' })).toBeNull();
  });

  it("every player's built cards are tappable in the Table sheet and the player sheet", () => {
    inGame(gameMsg(built, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('dialog', { name: 'Table' });
    fireEvent.click(within(within(table).getByRole('list', { name: 'Built cards of Cleo' })).getByRole('button', { name: `About ${nameOf(2)}` }));
    expect(screen.getByRole('dialog', { name: nameOf(2) })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog', { name: nameOf(2) })).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(table).getAllByRole('button').find((b) => b.classList.contains('neighbor') && b.textContent!.includes('Bob'))!);
    const panel = screen.getByRole('dialog', { name: 'Bob' });
    fireEvent.click(within(panel).getByRole('button', { name: `About ${nameOf(1)}` }));
    expect(screen.getByRole('dialog', { name: nameOf(1) })).toBeTruthy();
  });
});

describe('card animations', () => {
  const next = withBuilt(s, [1]);

  it("highlight a neighbour's new card and slide the new hand in from the passing side", () => {
    const h = inGame(gameMsg(s, 0));
    act(() => h.sock().receive(gameMsg(next, 0)));
    expect(document.querySelectorAll('.built-chip.fresh')).toHaveLength(1);
    act(() => h.sock().receive(gameMsg({ ...next, turn: 2 }, 0)));
    // Term I passes left, so my next hand comes from the right.
    expect(document.querySelector('.hand')!.className).toContain('slide-from-right');
  });

  it('are off with the Animations setting (no-anim)', () => {
    const storage = memoryStorage();
    storage.setItem('arcane.prefs', JSON.stringify({ animations: false }));
    const h = inGame(gameMsg(s, 0), storage);
    expect(document.documentElement.classList.contains('no-anim')).toBe(true);
    act(() => h.sock().receive(gameMsg(next, 0)));
    act(() => h.sock().receive(gameMsg({ ...withBuilt(next, [0]), turn: 2, term: 2 }, 0)));
    expect(document.querySelector('.built-chip.fresh, .slide-from-left, .slide-from-right, .coin-pop, .tuck-card, .pass-glyph.flip')).toBeNull();
  });
});
