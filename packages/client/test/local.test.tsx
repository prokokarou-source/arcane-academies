import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameClient } from '../src/net/client';
import { harness, memoryStorage } from './fakeSocket';
import { renderApp } from './render';

afterEach(cleanup);

/** Tap the first legal action whenever one is offered, dismiss duels, and let the bots' timers run, until the game ends. */
function playToEnd(client: GameClient, runTimers: () => void, maxSteps = 2000): void {
  for (let i = 0; i < maxSteps; i++) {
    const s = client.getState();
    if (s.game?.result) return;
    if (s.duels) client.clearDuels();
    if (s.game && s.game.legal.length > 0 && !s.acting) client.act(s.game.legal[0]);
    else runTimers();
  }
  throw new Error('game did not end');
}

describe('solo game in the browser', () => {
  it('plays a full game against bots to the end without the server', () => {
    const h = harness();
    h.client.start();
    h.client.solo('Ana', 2, 'easy');
    const s = h.client.getState();
    expect(s).toMatchObject({ local: true, seatId: 's1', hostId: 's1' });
    expect(s.game!.deadline).toBeNull();
    expect(s.game!.seats.map((x) => x.kind)).toEqual(['human', 'bot', 'bot']);
    // Bots wait a natural moment before they move.
    expect(h.timers.some((t) => t.ms >= 700 && t.ms < 1300)).toBe(true);
    let sawDuels = false;
    const off = h.client.subscribe(() => (sawDuels ||= !!h.client.getState().duels));
    playToEnd(h.client, h.runTimers);
    off();
    const end = h.client.getState().game!;
    expect(end.view.phase).toBe('ended');
    expect(end.result!.scores).toHaveLength(3);
    expect(end.result!.winners.length).toBeGreaterThan(0);
    expect(sawDuels).toBe(true);
    // Nothing went to the server: no socket was ever open.
    expect(h.sockets.every((x) => x.sent.length === 0)).toBe(true);
  });

  it('two seats add the Rival Archmage, as online', () => {
    const h = harness();
    h.client.start();
    h.client.solo('Ana', 1, 'normal');
    expect(h.client.getState().game!.seats.map((x) => x.kind)).toEqual(['human', 'archmage', 'bot']);
    playToEnd(h.client, h.runTimers);
    expect(h.client.getState().game!.result!.scores).toHaveLength(3);
  });

  it('resumes after a reload, and Leave game forgets it', () => {
    const storage = memoryStorage();
    const first = harness(storage);
    first.client.start();
    first.client.solo('Bea', 3, 'hard');
    for (let i = 0; i < 3; i++) {
      const g = first.client.getState().game!;
      first.client.act(g.legal[0]);
      first.runTimers();
      first.client.clearDuels();
    }
    const before = first.client.getState().game!.view;
    expect(before.turn + (before.term - 1) * 10).toBeGreaterThan(1);
    first.client.stop();

    const second = harness(storage);
    second.client.start();
    const back = second.client.getState();
    expect(back).toMatchObject({ local: true, seatId: 's1', restoring: false });
    expect(back.game!.view).toEqual(before);

    second.client.leave();
    expect(second.client.getState()).toMatchObject({ local: false, game: null, seatId: null, notice: 'left' });
    expect(storage.data.has('arcane.local')).toBe(false);
    const third = harness(storage);
    third.client.start();
    expect(third.client.getState().game).toBeNull();
  });

  it('"Back to lobby" after a solo game returns to the menu instead of starting again', () => {
    const h = harness();
    h.client.start();
    h.client.solo('Ana', 3, 'easy');
    playToEnd(h.client, h.runTimers);
    h.client.rematch();
    expect(h.client.getState()).toMatchObject({ game: null, local: false, notice: null });
  });

  it('Play again deals a fresh game with the same bots', () => {
    const h = harness();
    h.client.start();
    h.client.solo('Ana', 3, 'easy');
    playToEnd(h.client, h.runTimers);
    h.client.playAgain(true);
    const g = h.client.getState().game!;
    expect(g.result).toBeUndefined();
    expect(g.view).toMatchObject({ term: 1, turn: 1 });
    expect(g.seats.map((x) => x.name)).toEqual(['Ana', 'Bot 1', 'Bot 2', 'Bot 3']);
  });

  it('"Play again" starts the next local game straight away, with nothing sent to the server', () => {
    const h = harness();
    h.client.start();
    h.client.solo('Ana', 2, 'easy');
    playToEnd(h.client, h.runTimers);
    const sent = h.sockets.flatMap((s) => s.sent).length;
    h.client.playAgain(true);
    expect(h.client.getState().game?.result).toBeUndefined();
    expect(h.client.getState().game?.view).toMatchObject({ term: 1, turn: 1 });
    expect(h.sockets.flatMap((s) => s.sent)).toHaveLength(sent);
  });

  it('the end screen offers Play again and Main menu only', () => {
    const r = renderApp();
    act(() => {
      r.client.solo('Ana', 2, 'easy');
      playToEnd(r.client, r.runTimers);
    });
    expect(screen.getByText('Game over')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lobby' })).toBeNull();
    expect(screen.queryByText(/ready/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(r.client.getState().game?.view).toMatchObject({ term: 1, turn: 1 });
    act(() => playToEnd(r.client, r.runTimers));
    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));
    expect(r.client.getState()).toMatchObject({ local: false, game: null, notice: null });
  });

  it('starts from the Play tab while the server is unreachable', () => {
    const r = renderApp();
    act(() => r.sock().serverClose(1006));
    fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));
    expect(screen.getByText('Term I')).toBeTruthy();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
    expect(r.sockets.every((x) => x.sent.length === 0)).toBe(true);
    expect(r.client.getState().local).toBe(true);
  });
});
