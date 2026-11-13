import type { GameState, PowerId } from './types';
import { academyDef } from './data/academies';
import { leftOf, rightOf } from './payment';

/** True when the seat has built the tower stage that carries this power. */
export function hasPower(s: GameState, seat: number, power: PowerId): boolean {
  const p = s.players[seat];
  return academyDef(p.academyId).sides[p.side].slice(0, p.towerStages).some((st) => st.power === power);
}

/** Effects that trigger once, when the stage with the power is built. */
export function applyPowerOnBuild(s: GameState, seat: number, power: PowerId | undefined): GameState {
  if (power !== 'shadowTax') return s;
  const coins = s.players.map((p) => p.coins);
  for (const n of [leftOf(s, seat), rightOf(s, seat)]) {
    if (n === seat) continue;
    const take = Math.min(2, coins[n]);
    coins[n] -= take;
    coins[seat] += take;
  }
  return { ...s, players: s.players.map((p, i) => ({ ...p, coins: coins[i] })) };
}
