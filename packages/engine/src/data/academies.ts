import type { AcademyDef, Cost, Effect, PowerId, Resource, TowerStage } from '../types';

const res = (r: Partial<Record<Resource, number>>): Cost => ({ resources: r });
const renown = (amount: number): Effect => ({ kind: 'renown', amount });
const stage = (cost: Cost, effects: Effect[], power?: PowerId): TowerStage => ({ cost, effects, ...(power ? { power } : {}) });

function academy(id: string, name: string, home: Resource, power: PowerId, costs: [Cost, Cost, Cost], bCosts: Cost[]): AcademyDef {
  const A = [stage(costs[0], [renown(3)]), stage(costs[1], [], power), stage(costs[2], [renown(7)])];
  const B =
    bCosts.length === 2
      ? [stage(bCosts[0], [renown(2)], power), stage(bCosts[1], [renown(8)])]
      : [stage(bCosts[0], [renown(2)]), stage(bCosts[1], [renown(3)], power), stage(bCosts[2], [renown(5)])];
  return { id, name, home, sides: { A, B } };
}

export const ACADEMIES: readonly AcademyDef[] = [
  academy('pyromancy', 'Pyromancy Academy', 'ore', 'pyroDuelBonus',
    [res({ ore: 2 }), res({ herbs: 2, essence: 1 }), res({ ore: 3, dragonscale: 1 })],
    [res({ ore: 2, ink: 1 }), res({ herbs: 3, starglass: 1 })]),
  academy('hydromancy', 'Hydromancy Academy', 'moonstone', 'hydroTradeBonus',
    [res({ moonstone: 2 }), res({ ink: 2, starglass: 1 }), res({ moonstone: 3, essence: 1 })],
    [res({ moonstone: 1, herbs: 1 }), res({ ink: 2, essence: 1 }), res({ ore: 3, starglass: 1 })]),
  academy('verdant', 'Verdant Circle', 'herbs', 'verdantWhiteRenown',
    [res({ herbs: 2 }), res({ ore: 2, dragonscale: 1 }), res({ herbs: 3, starglass: 1 })],
    [res({ herbs: 2, ink: 1 }), res({ moonstone: 3, essence: 1 })]),
  academy('shadow', 'Shadow Conservatory', 'ink', 'shadowTax',
    [res({ ink: 2 }), res({ moonstone: 2, essence: 1 }), res({ ink: 3, dragonscale: 1 })],
    [res({ ink: 1, ore: 1 }), res({ herbs: 2, starglass: 1 }), res({ moonstone: 3, essence: 1 })]),
  academy('astral', 'Astral Observatory', 'starglass', 'astralSetBonus',
    [res({ moonstone: 2 }), res({ ink: 2, starglass: 1 }), res({ ore: 3, essence: 1 })],
    [res({ herbs: 2, moonstone: 1 }), res({ ink: 3, dragonscale: 1 })]),
  academy('chronomancy', 'Chronomancy Academy', 'essence', 'chronoKeep',
    [res({ herbs: 2 }), res({ ore: 2, starglass: 1 }), res({ ink: 3, essence: 1 })],
    [res({ ore: 1, moonstone: 1 }), res({ herbs: 2, dragonscale: 1 }), res({ ink: 3, starglass: 1 })]),
  academy('runeforge', 'Runeforge', 'dragonscale', 'runeChainCoins',
    [res({ ore: 2 }), res({ moonstone: 2, dragonscale: 1 }), res({ herbs: 3, essence: 1 })],
    [res({ ore: 2, herbs: 1 }), res({ ink: 3, starglass: 1 })]),
];

/** Look up an academy by id. Throws on unknown id. */
export function academyDef(id: string): AcademyDef {
  const a = ACADEMIES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown academy id: ${id}`);
  return a;
}
