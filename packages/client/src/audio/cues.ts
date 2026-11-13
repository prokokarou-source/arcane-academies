/** Which sounds a change in the client state calls for. Pure, so the same state twice is always silent. */
import type { ClientState } from '../net/client';

export type Cue =
  | 'select'
  | 'build'
  | 'tower'
  | 'sell'
  | 'turn'
  | 'tick'
  | 'clash'
  | 'duelWin'
  | 'duelLoss'
  | 'victory'
  | 'gameOver'
  | 'join'
  | 'start'
  | 'tap';

export const CUES: Cue[] = ['select', 'build', 'tower', 'sell', 'turn', 'tick', 'clash', 'duelWin', 'duelLoss', 'victory', 'gameOver', 'join', 'start', 'tap'];

type Game = NonNullable<ClientState['game']>;
const turnKey = (g: Game) => `${g.view.term}/${g.view.turn}/${g.view.phase}`;

export function cuesFor(prev: ClientState | null, next: ClientState): Cue[] {
  if (!prev) return [];
  const out: Cue[] = [];

  if (prev.lobby && next.lobby && next.lobby.seats.length > prev.lobby.seats.length) out.push('join');

  const g = next.game;
  if (!g) return out;
  if (!prev.game) {
    // Only a lobby turning into a game is a start; a game restored after a reload is not.
    if (prev.lobby) out.push('start');
    return out;
  }

  if (next.duels && !prev.duels) {
    out.push('clash');
    const sum = next.duels.deltas.reduce((a, b) => a + b, 0);
    if (sum > 0) out.push('duelWin');
    else if (sum < 0) out.push('duelLoss');
  }

  if (g.result && !prev.game.result) {
    out.push(g.result.winners.includes(g.view.me) ? 'victory' : 'gameOver');
  } else if (g.view.phase !== 'ended' && turnKey(g) !== turnKey(prev.game)) {
    out.push('turn');
  }
  return out;
}
