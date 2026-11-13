import type { Card, GameState, PlayerState } from './types';

export type PublicPlayer = Omit<PlayerState, 'hand' | 'pending' | 'towerCards'> & {
  handSize: number;
  hasSubmitted: boolean;
  towerCardCount: number;
  hand?: Card[];
  kept?: Card | null;
};

export type PlayerView = Omit<GameState, 'players' | 'rngState' | 'seed' | 'kept'> & {
  me: number;
  players: PublicPlayer[];
};

/** What one seat may see: its own hand and kept card; everyone else only public information. */
export function viewFor(s: GameState, seat: number): PlayerView {
  const { players, rngState: _r, seed: _s, kept, ...rest } = s;
  return {
    ...rest,
    me: seat,
    players: players.map((p) => {
      const { hand, pending, towerCards, ...pub } = p;
      const base: PublicPlayer = { ...pub, handSize: hand.length, hasSubmitted: !!pending, towerCardCount: towerCards.length };
      return p.seat === seat ? { ...base, hand, kept: kept[seat] } : base;
    }),
  };
}
