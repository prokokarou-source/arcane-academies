import type { AcademyDef, Cost, Effect, PowerId, Resource, TowerStage } from '../types';
import { BASIC_RESOURCES, RARE_RESOURCES } from '../types';

const res = (r: Partial<Record<Resource, number>>): Cost => ({ resources: r });
const renown = (amount: number): Effect => ({ kind: 'renown', amount });
const coins = (amount: number): Effect => ({ kind: 'coins', amount });
const duel = (amount: number): Effect => ({ kind: 'duel', amount });
const anyBasic: Effect = { kind: 'produce', options: [...BASIC_RESOURCES], amount: 1 };
const anyRare: Effect = { kind: 'produce', options: [...RARE_RESOURCES], amount: 1 };
const researchAny: Effect = { kind: 'researchAny' };
const fromDiscard: Effect = { kind: 'buildDiscard' };
const stage = (cost: Cost, effects: Effect[], power?: PowerId): TowerStage => ({ cost, effects, ...(power ? { power } : {}) });

const LIST: AcademyDef[] = [
  {
    id: 'hydromancy',
    name: 'Hydromancy Academy',
    home: 'moonstone',
    sides: {
      A: [stage(res({ herbs: 2 }), [renown(3)]), stage(res({ ink: 2, essence: 1 }), [renown(5)]), stage(res({ moonstone: 4 }), [renown(7)])],
      B: [
        stage(res({ herbs: 2 }), [renown(3)]),
        stage(res({ moonstone: 3 }), [renown(5)]),
        stage(res({ ink: 3 }), [renown(5)]),
        stage(res({ moonstone: 4, dragonscale: 1 }), [renown(7)]),
      ],
    },
  },
  {
    id: 'pyromancy',
    name: 'Pyromancy Academy',
    home: 'ore',
    sides: {
      A: [stage(res({ herbs: 2 }), [renown(3)]), stage(res({ ink: 3 }), [duel(2)]), stage(res({ ore: 4 }), [renown(7)])],
      B: [stage(res({ moonstone: 3 }), [renown(3), coins(3), duel(1)]), stage(res({ ore: 4 }), [renown(4), coins(4), duel(1)])],
    },
  },
  {
    id: 'astral',
    name: 'Astral Observatory',
    home: 'starglass',
    sides: {
      A: [stage(res({ moonstone: 2 }), [renown(3)]), stage(res({ ore: 2 }), [anyBasic]), stage(res({ dragonscale: 1, essence: 1 }), [renown(7)])],
      B: [stage(res({ ink: 2 }), [anyBasic]), stage(res({ ore: 3 }), [anyRare]), stage(res({ herbs: 4 }), [renown(7)])],
    },
  },
  {
    id: 'runeforge',
    name: 'Runeforge',
    home: 'dragonscale',
    sides: {
      A: [stage(res({ ink: 2 }), [renown(3)]), stage(res({ herbs: 2 }), [coins(9)]), stage(res({ ore: 2, starglass: 1 }), [renown(7)])],
      B: [
        stage(res({ moonstone: 2 }), [renown(2), coins(4)]),
        stage(res({ herbs: 2 }), [renown(3), coins(4)]),
        stage(res({ ore: 2, essence: 1 }), [renown(5), coins(4)]),
      ],
    },
  },
  {
    id: 'verdant',
    name: 'Verdant Circle',
    home: 'herbs',
    sides: {
      A: [stage(res({ ink: 2 }), [renown(3)]), stage(res({ ore: 2, essence: 1 }), [researchAny]), stage(res({ herbs: 4 }), [renown(7)])],
      B: [stage(res({ moonstone: 2 }), [], 'playLastCard'), stage(res({ ink: 3, starglass: 1 }), [researchAny])],
    },
  },
  {
    id: 'shadow',
    name: 'Shadow Conservatory',
    home: 'ink',
    sides: {
      A: [stage(res({ moonstone: 2 }), [renown(3)]), stage(res({ herbs: 2 }), [], 'freeNewFamily'), stage(res({ ink: 3 }), [renown(7)])],
      B: [
        stage(res({ ore: 2 }), [renown(2)], 'freeFirstTurn'),
        stage(res({ ink: 3 }), [renown(3)], 'freeSixthTurn'),
        stage(res({ starglass: 1, dragonscale: 1, essence: 1 }), [renown(5)]),
      ],
    },
  },
  {
    id: 'chronomancy',
    name: 'Chronomancy Academy',
    home: 'essence',
    sides: {
      A: [stage(res({ ore: 2 }), [renown(3)]), stage(res({ starglass: 1, dragonscale: 1 }), [fromDiscard]), stage(res({ moonstone: 3 }), [renown(7)])],
      B: [
        stage(res({ ink: 2 }), [renown(2), fromDiscard]),
        stage(res({ starglass: 1, dragonscale: 1 }), [renown(1), fromDiscard]),
        stage(res({ herbs: 3 }), [fromDiscard]),
      ],
    },
  },
];

/** Seven academies, in a fixed order (it drives random assignment). Each has a home resource it always produces and two tower sides (A: day, B: night). */
export const ACADEMIES: readonly AcademyDef[] = ['pyromancy', 'hydromancy', 'verdant', 'shadow', 'astral', 'chronomancy', 'runeforge'].map(
  (id) => LIST.find((a) => a.id === id)!,
);

/** Look up an academy by id. Throws on unknown id. */
export function academyDef(id: string): AcademyDef {
  const a = ACADEMIES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown academy id: ${id}`);
  return a;
}
