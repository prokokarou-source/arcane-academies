import { createGame, legalActions, viewFor, type GameState, type SeatConfig } from '@arcane/engine';
import type { SeatStatus, ServerMessage } from '@arcane/protocol';

export type GameMsg = Extract<ServerMessage, { t: 'game' }>;

const ACADS = ['pyromancy', 'hydromancy', 'verdant', 'shadow', 'astral', 'chronomancy', 'runeforge'];

/** A real engine game with human seats named after the given names. */
export function makeGame(names: string[], seed = 7): GameState {
  const seats: SeatConfig[] = names.map((name, i) => ({ kind: 'human', name, academyId: ACADS[i], side: 'A' }));
  return createGame({ seed, seats });
}

export function seatsOf(s: GameState): SeatStatus[] {
  return s.players.map((p) => ({ seat: p.seat, name: p.config.name, kind: p.config.kind, connected: true, botControlled: false }));
}

export function gameMsg(s: GameState, seat: number, extra: Partial<GameMsg> = {}): GameMsg {
  const legal = s.players[seat].pending ? [] : legalActions(s, seat);
  return { t: 'game', view: viewFor(s, seat), legal, seats: seatsOf(s), deadline: null, ...extra };
}
