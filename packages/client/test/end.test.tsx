import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, type PlayerView } from '@arcane/engine';
import type { GameResult } from '@arcane/protocol';
import { renderApp } from './render';
import { gameMsg, makeGame, type GameMsg } from './views';

afterEach(cleanup);

const s = makeGame(['Ana', 'Bob', 'Cleo']);
const duelCard = CARDS.find((c) => c.family === 'duel' && c.term === 1)!;
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
      lobby: { code: 'WAND-42', inviteUrl: 'x', hostId, seats: [], settings: { graceMs: 60_000, turnTimerMs: null } },
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
    scores: [0, 1, 2].map((seat) => ({ seat, duels: seat, coins: 1, tower: 3, lore: 4, trade: 0, research: 2, patrons: 0, total: 10 + seat })),
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
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Sell +3' })).toBeNull();
  });

  it('host sees rematch and sends it', () => {
    const h = play('s1', 's1', [ended(0)]);
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(h.sock().sent).toEqual([{ t: 'rematch' }]);
  });

  it('non-host sees waiting text', () => {
    play('s2', 's1', [ended(1)]);
    expect(screen.getByText('Waiting for the host to start a rematch…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
  });

  it('non-host may rematch when someone is offline (the host may be gone)', () => {
    const g = ended(1);
    play('s2', 's1', [{ ...g, seats: g.seats.map((x, i) => (i === 0 ? { ...x, connected: false } : x)) }]);
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeTruthy();
  });

  it('marks the Archmage as unable to win', () => {
    const two = makeGame(['Ana', 'Bob']);
    const g = gameMsg(two, 0);
    play('s1', 's1', [{ ...g, view: { ...g.view, phase: 'ended' }, legal: [], result: { ...result, winners: [0] } }]);
    expect(screen.getByText(/can't win/)).toBeTruthy();
  });
});
