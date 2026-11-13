import { createGame } from '../src/setup';
import type { GameState, SeatConfig } from '../src/types';

export const seats = (n: number): SeatConfig[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'bot', name: `P${i}`, botLevel: 'normal' }) as SeatConfig);

/** 3-seat game with fixed academies: seat0 pyromancy(ore), seat1 hydromancy(moonstone), seat2 verdant(herbs). */
export function fixedGame(seed = 1): GameState {
  const cfg = seats(3);
  cfg[0] = { ...cfg[0], academyId: 'pyromancy' };
  cfg[1] = { ...cfg[1], academyId: 'hydromancy' };
  cfg[2] = { ...cfg[2], academyId: 'verdant' };
  return createGame({ seed, seats: cfg });
}

export function withBuilt(s: GameState, seat: number, defIds: string[]): GameState {
  return {
    ...s,
    players: s.players.map((p) =>
      p.seat === seat ? { ...p, built: [...p.built, ...defIds.map((d) => ({ uid: `${d}#x`, defId: d }))] } : p,
    ),
  };
}

export function withCoins(s: GameState, seat: number, coins: number): GameState {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, coins } : p)) };
}

export function withHand(s: GameState, seat: number, defIds: string[]): GameState {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat ? { ...p, hand: defIds.map((d, i) => ({ uid: `${d}#h${i}`, defId: d })) } : p)),
  };
}

export function withTower(s: GameState, seat: number, stages: number): GameState {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, towerStages: stages } : p)) };
}
