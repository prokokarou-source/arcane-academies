import { describe, expect, it } from 'vitest';
import { cuesFor } from '../src/audio/cues';
import type { ClientState } from '../src/net/client';

const base = { lobby: null, game: null, duels: null } as unknown as ClientState;
const lobby = (n: number) => ({ ...base, lobby: { seats: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })) } }) as unknown as ClientState;
const game = (term: number, turn: number, o: { phase?: string; winners?: number[] } = {}) =>
  ({
    ...base,
    game: { view: { term, turn, phase: o.phase ?? 'picking', me: 0 }, ...(o.winners ? { result: { winners: o.winners, scores: [] } } : {}) },
  }) as unknown as ClientState;
const withDuels = (s: ClientState, deltas: number[]) => ({ ...s, duels: { term: 1, view: s.game!.view, deltas } }) as ClientState;

describe('cuesFor', () => {
  it('is silent on the first state', () => {
    expect(cuesFor(null, game(1, 1))).toEqual([]);
  });

  it('a player joining the lobby', () => {
    expect(cuesFor(lobby(2), lobby(3))).toEqual(['join']);
    expect(cuesFor(lobby(3), lobby(2))).toEqual([]);
  });

  it('the game starting', () => {
    expect(cuesFor(lobby(3), game(1, 1))).toEqual(['start']);
  });

  it('a new turn, but not the same turn again after a reconnect', () => {
    expect(cuesFor(game(1, 1), game(1, 2))).toEqual(['turn']);
    expect(cuesFor(game(1, 2), game(1, 2))).toEqual([]);
  });

  it('term-end duels: clash, then win or loss by the tokens gained', () => {
    const g = game(2, 1);
    expect(cuesFor(game(1, 6), withDuels(g, [3, -1]))).toEqual(['clash', 'duelWin', 'turn']);
    expect(cuesFor(game(1, 6), withDuels(g, [-1, -1]))).toEqual(['clash', 'duelLoss', 'turn']);
    expect(cuesFor(game(1, 6), withDuels(g, [0, 0]))).toEqual(['clash', 'turn']);
    expect(cuesFor(withDuels(g, [1]), withDuels(g, [1]))).toEqual([]);
  });

  it('game end: victory for a winner, otherwise game over', () => {
    expect(cuesFor(game(3, 6), game(3, 6, { phase: 'ended', winners: [0] }))).toEqual(['victory']);
    expect(cuesFor(game(3, 6), game(3, 6, { phase: 'ended', winners: [2] }))).toEqual(['gameOver']);
  });
});
