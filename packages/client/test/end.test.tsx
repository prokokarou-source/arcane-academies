import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, type PlayerView } from '@arcane/engine';
import type { GameResult } from '@arcane/protocol';
import { renderApp } from './render';
import { gameMsg, makeGame, type GameMsg } from './views';

afterEach(cleanup);

const s = makeGame(['Ana', 'Bob', 'Cleo']);
const duelCard = CARDS.find((c) => c.family === 'duel' && c.term === 1)!;
const loreCard = CARDS.find((c) => c.family === 'lore' && c.term === 1)!;
const withDuels = (v: PlayerView, built: number[], tokens: number[][]): PlayerView => ({
  ...v,
  duelTokens: tokens,
  players: v.players.map((p, i) => ({ ...p, built: Array.from({ length: built[i] }, (_, k) => ({ uid: `d${i}-${k}`, defId: duelCard.id })) })),
});

function play(me: string, hostId: string, msgs: GameMsg[]) {
  const h = renderApp();
  act(() => {
    h.sock().receive({ t: 'joined', code: 'WAND-42', seatId: me, token: 't' });
    h.sock().receive({
      t: 'lobby',
      lobby: { code: 'WAND-42', inviteUrl: 'x', hostId, seats: [], settings: { graceMs: 60_000, turnTimerMs: null }, config: { sideMode: 'random' as const, turnTimerMs: null, seats: 7, public: false, bots: 0, botLevel: 'normal' as const }, kind: 'room' as const, },
    });
    for (const m of msgs) h.sock().receive(m);
  });
  h.sock().sent.length = 0;
  return h;
}

describe('Term end', () => {
  const base = gameMsg(s, 0);
  const before = { ...base, view: withDuels(base.view, [1, 2, 0], [[], [], []]) };
  const after = { ...base, view: { ...withDuels(base.view, [1, 2, 0], [[1, -1], [1, 1], [-1, -1]]), term: 2 as const } };

  it('shows duel results after a Term', () => {
    play('s1', 's1', [before, after]);
    expect(screen.getByText('Term I duels')).toBeTruthy();
    expect(screen.getByText(/Win/).textContent).toContain('+1');
    expect(screen.getByText(/Loss/).textContent).toContain('-1');
    expect(screen.getByText('vs Cleo')).toBeTruthy();
    expect(screen.getByText('vs Bob')).toBeTruthy();
  });

  it('stays open when the next turn arrives and continue closes it', () => {
    play('s1', 's1', [before, after, after]);
    expect(screen.getByText('Term I duels')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByText('Term I duels')).toBeNull();
  });

  it('shows a tie when duel power is equal', () => {
    const eq = { ...base, view: { ...withDuels(base.view, [0, 0, 0], [[], [], []]), term: 2 as const } };
    const prev = { ...base, view: withDuels(base.view, [0, 0, 0], [[], [], []]) };
    // Every duel tied: no tokens, but the duel screen still shows both ties.
    play('s1', 's1', [prev, eq]);
    expect(screen.getByText('Term I duels')).toBeTruthy();
    expect(screen.getAllByText('Tie')).toHaveLength(2);
  });
});

describe('Game end', () => {
  const result: GameResult = {
    scores: [0, 1, 2].map((seat) => ({
      seat,
      duels: seat,
      coins: 1,
      tower: 3,
      lore: 4,
      trade: 0,
      research: 2,
      patrons: 0,
      total: 10 + seat,
      items: [
        ...(seat ? [{ cat: 'duels' as const, kind: 'duels' as const, points: seat }] : []),
        { cat: 'coins', kind: 'coins', n: 4, points: 1 },
        { cat: 'tower', kind: 'stage', stage: 1, points: 3 },
        { cat: 'lore', kind: 'card', defId: loreCard.id, points: 4 },
        { cat: 'research', kind: 'research', points: 2 },
      ],
    })),
    winners: [2],
  };
  const ended = (seat: number): GameMsg => {
    const g = gameMsg(s, seat);
    return { ...g, view: { ...g.view, phase: 'ended' }, legal: [], result };
  };

  it('lists all categories and the winner', () => {
    play('s1', 's1', [ended(0)]);
    expect(screen.getByText('Game over')).toBeTruthy();
    expect(screen.getByText('Cleo wins!')).toBeTruthy();
    for (const c of ['Duels', 'Coins', 'Tower', 'Lore', 'Trade', 'Research', 'Patrons', 'Total']) {
      expect(screen.getByRole('columnheader', { name: c })).toBeTruthy();
    }
    // 1 header + 3 players + my own breakdown, open by default
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.queryByText('Waiting for the others…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sell +3' })).toBeNull();
  });

  it('shows my per-source breakdown and lets me open another player', () => {
    play('s1', 's1', [ended(0)]);
    const mine = screen.getByRole('button', { name: /Show where Ana/ });
    expect(mine.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(loreCard.name)).toBeTruthy();
    expect(screen.getByText('Tower stage 1')).toBeTruthy();
    expect(screen.getByText('4 coins')).toBeTruthy();
    expect(screen.queryByText('Duel tokens')).toBeNull(); // Ana has no duel points
    fireEvent.click(screen.getByRole('button', { name: /Show where Cleo/ }));
    expect(mine.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Duel tokens')).toBeTruthy();
    expect(screen.getByText('Duel tokens').closest('li')!.textContent).toContain('+2');
    fireEvent.click(screen.getByRole('button', { name: /Show where Cleo/ }));
    expect(screen.queryByText('Duel tokens')).toBeNull();
  });

  /** Ended game with the server's host and ready marks (Ana s1 is host). */
  const endedWith = (seat: number, ready: boolean[], connected = [true, true, true]) => {
    const g = ended(seat);
    return { ...g, seats: g.seats.map((x, i) => ({ ...x, host: i === 0, ready: ready[i], connected: connected[i] })) };
  };

  it('everyone sees Play again and the ready count; tapping it marks me ready', () => {
    const h = play('s2', 's1', [endedWith(1, [true, false, false])]);
    expect(screen.getByText(/1\/3 ready/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to lobby' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(h.sock().sent).toEqual([{ t: 'playAgain', ready: true }]);
  });

  it('once ready I can take it back', () => {
    const h = play('s2', 's1', [endedWith(1, [false, true, false])]);
    expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(h.sock().sent).toEqual([{ t: 'playAgain', ready: false }]);
  });

  it('the host can start now or go back to the lobby', () => {
    const h = play('s1', 's1', [endedWith(0, [false, true, false])]);
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to lobby' }));
    expect(h.sock().sent).toEqual([{ t: 'playAgainNow' }, { t: 'rematch' }]);
  });

  it('when the host is gone anyone may start; offline players do not count', () => {
    play('s2', 's1', [endedWith(1, [false, true, false], [false, true, true])]);
    expect(screen.getByText(/1\/2 ready/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start now' })).toBeTruthy();
  });

  it('a new game after the end screen starts clean', () => {
    const h = play('s1', 's1', [endedWith(0, [true, true, true])]);
    act(() => h.sock().receive(gameMsg(s, 0)));
    expect(screen.queryByText('Game over')).toBeNull();
    expect(h.client.getState()).toMatchObject({ prevView: null, duels: null });
  });

  it('marks the Archmage as unable to win', () => {
    const two = makeGame(['Ana', 'Bob']);
    const g = gameMsg(two, 0);
    play('s1', 's1', [{ ...g, view: { ...g.view, phase: 'ended' }, legal: [], result: { ...result, winners: [0] } }]);
    expect(screen.getByText(/can't win/)).toBeTruthy();
  });
});
