import { createGame, autoPlay, resolveTurn, finalScores, winners } from '../../engine/src/index';
import type { BotLevel, SeatConfig } from '../../engine/src/index';

/**
 * Head-to-head bot arena: two levels share every table, seats alternate and the pattern is
 * rotated each game so neither level keeps a seat or academy advantage.
 * Usage: npm run arena -- --a hard --b normal --games 200 --players 4
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const a = arg('a', 'hard') as BotLevel;
const b = arg('b', 'normal') as BotLevel;
const games = Number(arg('games', '200'));
const players = Number(arg('players', '4'));
const seed0 = Number(arg('seed', '1'));

const score = { [a]: 0, [b]: 0 } as Record<string, number>;
const seatsOf = { [a]: 0, [b]: 0 } as Record<string, number>;
const wins = { [a]: 0, [b]: 0 } as Record<string, number>;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const cfg: SeatConfig[] = Array.from({ length: players }, (_, i) => ({ kind: 'bot', name: `B${i}`, botLevel: (i + g) % 2 === 0 ? a : b }));
  let s = createGame({ seed: seed0 + g, seats: cfg });
  while (s.phase !== 'ended') s = resolveTurn(autoPlay(s));
  const w = winners(s);
  for (const sc of finalScores(s)) {
    const lv = s.players[sc.seat].config.botLevel;
    if (!lv) continue;
    score[lv] += sc.total;
    seatsOf[lv]++;
  }
  for (const seat of w) wins[s.players[seat].config.botLevel!] += 1 / w.length;
}
for (const lv of [a, b]) {
  console.log(`${lv.padEnd(7)} avg ${(score[lv] / seatsOf[lv]).toFixed(2)}  wins ${wins[lv].toFixed(1)}/${games}`);
}
console.log(`${games} games, ${players} players, ${((Date.now() - t0) / games).toFixed(1)} ms/game`);
