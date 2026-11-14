import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from './render';
import { gameMsg, makeGame, type GameMsg } from './views';

afterEach(cleanup);

function inGame(msg: GameMsg) {
  const h = renderApp();
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: 's1', token: 't' });
    h.sock().receive(msg);
  });
  h.sock().sent.length = 0;
  return h;
}

const withBots = (msg: GameMsg): GameMsg => ({ ...msg, seats: msg.seats.map((s) => (s.seat === 0 ? s : { ...s, kind: 'bot' })) });

describe('game menu', () => {
  it('opens Settings from the game and goes back to it', () => {
    inGame(gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('Language')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Term I')).toBeTruthy();
  });

  it('opens the Rules from the game and goes back to it', () => {
    inGame(gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.getByText('10. Duels')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Term I')).toBeTruthy();
  });

  it('leaving with other players says a bot takes over, and sends leave on confirm', () => {
    const h = inGame(gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave game' }));
    expect(screen.getByText('A bot will play your seat so the others can finish.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(h.sock().sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(h.sock().sent).toEqual([{ t: 'leave' }]);
  });

  it('leaving a game with only bots says it will end', () => {
    inGame(withBots(gameMsg(makeGame(['Ana', 'Bob', 'Cleo']), 0)));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave game' }));
    expect(screen.getByText('Only bots are left, so the game will end.')).toBeTruthy();
  });
});
