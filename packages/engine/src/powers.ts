import type { GameState, PowerId } from './types';
import { academyDef } from './data/academies';

/** True when the seat has built the tower stage that carries this power. */
export function hasPower(s: GameState, seat: number, power: PowerId): boolean {
  const p = s.players[seat];
  return academyDef(p.academyId).sides[p.side].slice(0, p.towerStages).some((st) => st.power === power);
}
