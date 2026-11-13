import type { CardDef, Cost, Effect, Family, Resource, Term, Discipline, CountTarget } from '../types';

// ---- helpers -------------------------------------------------------------
const res = (r: Partial<Record<Resource, number>>): Cost => ({ resources: r });
const coins = (n: number): Cost => ({ coins: n });
const free: Cost = {};
const produce = (amount: number, ...options: Resource[]): Effect => ({ kind: 'produce', options, amount });
const renown = (amount: number): Effect => ({ kind: 'renown', amount });
const duel = (amount: number): Effect => ({ kind: 'duel', amount });
const research = (discipline: Discipline): Effect => ({ kind: 'research', discipline });
const gold = (amount: number): Effect => ({ kind: 'coins', amount });
const coinsPer = (what: CountTarget, per: number, scope: 'self' | 'selfAndNeighbors'): Effect => ({ kind: 'coinsPer', what, per, scope });
const renownPer = (what: CountTarget, per: number, scope: 'self' | 'neighbors' | 'selfAndNeighbors'): Effect => ({ kind: 'renownPer', what, per, scope });

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function card(term: Term, family: Family, name: string, cost: Cost, effects: Effect[], minPlayers: number[], chainFrom?: string[]): CardDef {
  return { id: `t${term}-${slug(name)}`, name, term, family, cost, effects, minPlayers, ...(chainFrom ? { chainFrom } : {}) };
}

// ---- Term I --------------------------------------------------------------
const TERM_1: CardDef[] = [
  // basic (white) — 13 copies
  card(1, 'basic', 'Mandrake Bed', free, [produce(1, 'herbs')], [3, 4]),
  card(1, 'basic', 'Iron Seam', free, [produce(1, 'ore')], [3, 5]),
  card(1, 'basic', 'Inkcap Grove', free, [produce(1, 'ink')], [3, 6]),
  card(1, 'basic', 'Moonwell Pit', free, [produce(1, 'moonstone')], [3, 4]),
  card(1, 'basic', 'Root and Rock Dig', coins(1), [produce(1, 'herbs', 'ore')], [3]),
  card(1, 'basic', 'Tidepool Cut', coins(1), [produce(1, 'ink', 'moonstone')], [5]),
  card(1, 'basic', 'Bramble Hollow', coins(1), [produce(1, 'herbs', 'moonstone')], [6]),
  card(1, 'basic', 'Ashvein Shaft', coins(1), [produce(1, 'ore', 'ink')], [7]),
  card(1, 'basic', 'Wildgrowth Terrace', coins(1), [produce(1, 'herbs', 'ink')], [7]),
  // rare (black) — 7 copies
  card(1, 'rare', 'Essence Still', free, [produce(1, 'essence')], [3, 6]),
  card(1, 'rare', 'Starshard Kiln', free, [produce(1, 'starglass')], [3, 5]),
  card(1, 'rare', 'Dragon Roost', free, [produce(1, 'dragonscale')], [3, 7]),
  card(1, 'rare', 'Prism Hatchery', coins(1), [produce(1, 'starglass', 'dragonscale')], [4]),
  // lore (gold) — 8 copies
  card(1, 'lore', 'Reading Hall', res({ ink: 1 }), [renown(3)], [3, 7]),
  card(1, 'lore', 'Candle Chapel', res({ herbs: 1 }), [renown(3)], [3, 5]),
  card(1, 'lore', 'Founders Statue', free, [renown(2)], [4, 6]),
  card(1, 'lore', 'Steam Hall', res({ moonstone: 1 }), [renown(3)], [3, 4]),
  // trade (turquoise) — 8 copies
  card(1, 'trade', 'Westwind Courier', free, [{ kind: 'tradeDiscount', group: 'basic', sides: ['left'] }], [3]),
  card(1, 'trade', 'Eastwind Courier', free, [{ kind: 'tradeDiscount', group: 'basic', sides: ['right'] }], [3]),
  card(1, 'trade', 'Rare Goods Broker', free, [{ kind: 'tradeDiscount', group: 'rare', sides: ['left', 'right'] }], [3, 6]),
  card(1, 'trade', 'Alms Box', free, [gold(4)], [4, 6]),
  card(1, 'trade', 'Lucky Fountain', free, [gold(3)], [5, 7]),
  // duel (orange) — 6 copies
  card(1, 'duel', 'Practice Yard', res({ ore: 1 }), [duel(1)], [3, 5]),
  card(1, 'duel', 'Ward Circle', res({ moonstone: 1 }), [duel(1)], [3, 7]),
  card(1, 'duel', 'Sparring Tower', res({ herbs: 1 }), [duel(1)], [4, 6]),
  // research (magenta) — 7 copies
  card(1, 'research', 'Herbalist Lab', res({ moonstone: 1 }), [research('alchemy')], [3, 5]),
  card(1, 'research', 'Cauldron Room', res({ ore: 1 }), [research('alchemy')], [3]),
  card(1, 'research', 'Stargazer Loft', res({ ink: 1 }), [research('astronomy')], [3, 7]),
  card(1, 'research', 'Rune Desk', res({ herbs: 1 }), [research('runes')], [3]),
  card(1, 'research', 'Glyph Carver', res({ ore: 1 }), [research('runes')], [3]),
];

// ---- Term II -------------------------------------------------------------
const TERM_2: CardDef[] = [
  // basic (white) — 8 copies, all double producers
  card(2, 'basic', 'Mandrake Terraces', coins(1), [produce(2, 'herbs')], [3, 4]),
  card(2, 'basic', 'Deep Forge Mine', coins(1), [produce(2, 'ore')], [3, 4]),
  card(2, 'basic', 'Ink Vats', coins(1), [produce(2, 'ink')], [3, 4]),
  card(2, 'basic', 'Moonstone Cutters', coins(1), [produce(2, 'moonstone')], [3, 4]),
  // rare (black) — 7 copies
  card(2, 'rare', 'Essence Distillery', free, [produce(1, 'essence')], [3, 5]),
  card(2, 'rare', 'Starshard Furnace', free, [produce(1, 'starglass')], [3, 5]),
  card(2, 'rare', 'Dragon Hatchery', free, [produce(1, 'dragonscale')], [3, 6]),
  card(2, 'rare', 'Ember Prism', coins(1), [produce(1, 'essence', 'dragonscale')], [7]),
  // lore (gold) — 8 copies
  card(2, 'lore', 'Hall of Records', res({ ink: 2, essence: 1 }), [renown(4)], [3, 7], ['Reading Hall']),
  card(2, 'lore', 'Moon Fountain', res({ moonstone: 2, starglass: 1 }), [renown(5)], [3, 7], ['Steam Hall']),
  card(2, 'lore', 'Court of Arbiters', res({ ore: 1, herbs: 1, dragonscale: 1 }), [renown(4)], [3, 5]),
  card(2, 'lore', 'Shrine of Stars', res({ herbs: 2, starglass: 1 }), [renown(4)], [3, 6], ['Candle Chapel']),
  // trade (turquoise) — 9 copies
  card(2, 'trade', 'Grand Exchange', res({ herbs: 2 }), [produce(1, 'herbs', 'ore', 'ink', 'moonstone')], [3, 5, 6], ['Westwind Courier', 'Eastwind Courier']),
  card(2, 'trade', 'Curio Stall', res({ ore: 2 }), [produce(1, 'essence', 'starglass', 'dragonscale')], [3, 6, 7], ['Rare Goods Broker']),
  card(2, 'trade', 'Toll Bridge', free, [coinsPer('basic', 1, 'selfAndNeighbors')], [3, 6]),
  card(2, 'trade', 'Money Changer', free, [coinsPer('rare', 2, 'selfAndNeighbors')], [4]),
  // duel (orange) — 9 copies
  card(2, 'duel', 'Dueling Grounds', res({ ore: 2 }), [duel(2)], [3, 5], ['Practice Yard']),
  card(2, 'duel', 'Battle Mage Hall', res({ herbs: 1, ore: 1, dragonscale: 1 }), [duel(2)], [3, 6]),
  card(2, 'duel', 'Warded Walls', res({ moonstone: 3 }), [duel(2)], [3, 7], ['Ward Circle']),
  card(2, 'duel', 'Wand Range', res({ herbs: 2, ink: 1 }), [duel(2)], [4, 6, 7], ['Sparring Tower']),
  // research (magenta) — 8 copies
  card(2, 'research', 'Transmutation Lab', res({ herbs: 2, essence: 1 }), [research('alchemy')], [3, 5], ['Herbalist Lab']),
  card(2, 'research', 'Orrery Room', res({ ore: 2, starglass: 1 }), [research('astronomy')], [3, 4], ['Stargazer Loft']),
  card(2, 'research', 'Rune Library', res({ ink: 2, dragonscale: 1 }), [research('runes')], [3, 5], ['Rune Desk']),
  card(2, 'research', 'Sigil School', res({ moonstone: 2, essence: 1 }), [research('runes')], [3, 7], ['Glyph Carver']),
];

// ---- Term III ------------------------------------------------------------
const TERM_3: CardDef[] = [
  // lore (gold) — 10 copies
  card(3, 'lore', 'Archmage Palace', res({ herbs: 1, ore: 1, ink: 1, essence: 1, starglass: 1 }), [renown(8)], [3, 7]),
  card(3, 'lore', 'Great Archive Hall', res({ ink: 2, moonstone: 1, essence: 1 }), [renown(6)], [3, 6], ['Hall of Records']),
  card(3, 'lore', 'Celestial Dome', res({ moonstone: 2, starglass: 2, dragonscale: 1 }), [renown(7)], [3, 5], ['Shrine of Stars']),
  card(3, 'lore', 'Moonlit Gardens', res({ herbs: 2, moonstone: 1 }), [renown(5)], [3, 4], ['Moon Fountain']),
  card(3, 'lore', 'Council Chamber', res({ ore: 2, ink: 1, dragonscale: 1 }), [renown(6)], [3, 6], ['Court of Arbiters']),
  // trade (turquoise) — 10 copies
  card(3, 'trade', 'Merchant Spire', res({ ore: 1, ink: 1, essence: 1 }), [coinsPer('trade', 1, 'self'), renownPer('trade', 1, 'self')], [3, 6]),
  card(3, 'trade', 'Mine Charter', res({ herbs: 2, starglass: 1 }), [coinsPer('basic', 1, 'self'), renownPer('basic', 1, 'self')], [3, 4]),
  card(3, 'trade', 'Rare Charter', res({ ink: 2, dragonscale: 1 }), [coinsPer('rare', 2, 'self'), renownPer('rare', 2, 'self')], [4, 6]),
  card(3, 'trade', 'Scholars Purse', res({ moonstone: 2, essence: 1 }), [coinsPer('research', 2, 'self'), renownPer('research', 1, 'self')], [5, 7]),
  card(3, 'trade', 'Tower Patronage', res({ ore: 2, starglass: 1 }), [coinsPer('towerStage', 2, 'self'), renownPer('towerStage', 2, 'self')], [3, 5]),
  // duel (orange) — 10 copies
  card(3, 'duel', 'Siege Golem Pit', res({ ore: 3, essence: 1 }), [duel(3)], [3, 5]),
  card(3, 'duel', 'Dragon Riders', res({ herbs: 2, dragonscale: 2 }), [duel(3)], [3, 7], ['Dueling Grounds']),
  card(3, 'duel', 'Battle Spire', res({ ore: 2, moonstone: 1, starglass: 1 }), [duel(3)], [4, 6]),
  card(3, 'duel', 'Storm Bastion', res({ moonstone: 3, ink: 1 }), [duel(3)], [3, 7], ['Warded Walls']),
  card(3, 'duel', 'War Wand Armory', res({ herbs: 1, ore: 2, essence: 1 }), [duel(3)], [4, 5], ['Wand Range']),
  // research (magenta) — 10 copies
  card(3, 'research', 'Philosophers Forge', res({ herbs: 2, ore: 1, essence: 1 }), [research('alchemy')], [3, 7], ['Transmutation Lab']),
  card(3, 'research', 'Elixir Cellar', res({ moonstone: 2, ink: 1, essence: 1 }), [research('alchemy')], [3]),
  card(3, 'research', 'Star Observatory', res({ ore: 2, ink: 1, starglass: 1 }), [research('astronomy')], [3, 6], ['Orrery Room']),
  card(3, 'research', 'Comet Watch', res({ moonstone: 1, ink: 1, starglass: 2 }), [research('astronomy')], [3, 7]),
  card(3, 'research', 'Runic University', res({ ink: 2, herbs: 1, dragonscale: 1 }), [research('runes')], [3, 5], ['Rune Library']),
  card(3, 'research', 'Glyph Sanctum', res({ ore: 1, moonstone: 2, dragonscale: 1 }), [research('runes')], [4], ['Sigil School']),
];

export const CARDS: readonly CardDef[] = [...TERM_1, ...TERM_2, ...TERM_3];

// ---- Patrons (silver, Term III, drawn at random: seats + 2) --------------
const patron = (name: string, cost: Cost, effects: Effect[]) => card(3, 'patron', name, cost, effects, [3]);

export const PATRONS: readonly CardDef[] = [
  patron('Order of Diggers', res({ ore: 2, herbs: 1, moonstone: 1 }), [renownPer('basic', 1, 'selfAndNeighbors')]),
  patron('Gemcutters Circle', res({ ink: 2, starglass: 1, essence: 1 }), [renownPer('rare', 2, 'self'), renownPer('rare', 1, 'neighbors')]),
  patron('Lorekeepers Society', res({ ink: 2, moonstone: 2, essence: 1 }), [renownPer('lore', 1, 'selfAndNeighbors')]),
  patron('Merchant Princes', res({ herbs: 2, ore: 1, dragonscale: 1 }), [renownPer('trade', 2, 'self')]),
  patron('War College', res({ ore: 3, dragonscale: 1 }), [renownPer('duel', 1, 'selfAndNeighbors')]),
  patron('Stargazers Fellowship', res({ moonstone: 2, starglass: 2 }), [renownPer('research', 1, 'selfAndNeighbors')]),
  patron('Tower Builders League', res({ herbs: 2, ore: 2, essence: 1 }), [renownPer('towerStage', 2, 'self')]),
  patron('Collectors Circle', res({ ink: 1, herbs: 1, starglass: 1, dragonscale: 1 }), [renownPer('basic', 1, 'self'), renownPer('rare', 1, 'self')]),
  patron('Rivalry Board', res({ ore: 2, ink: 2 }), [renownPer('duel', 1, 'neighbors'), renownPer('lore', 1, 'neighbors')]),
  patron('Masters Conclave', res({ moonstone: 2, essence: 1, dragonscale: 1 }), [renownPer('towerStage', 1, 'selfAndNeighbors'), renown(2)]),
];

const ALL = new Map<string, CardDef>([...CARDS, ...PATRONS].map((c) => [c.id, c]));

/** Look up a card definition by id. Throws on unknown id. */
export function cardDef(defId: string): CardDef {
  const d = ALL.get(defId);
  if (!d) throw new Error(`Unknown card id: ${defId}`);
  return d;
}
