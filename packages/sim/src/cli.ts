import { createGame, autoPlay, resolveTurn, finalScores, winners, ACADEMIES } from '../../engine/src/index';
import type { BotLevel, SeatConfig, ScoreBreakdown } from '../../engine/src/index';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const games = Number(arg('games', '1000'));
const players = Number(arg('players', '4'));
const level = arg('level', 'normal') as BotLevel;
const seed0 = Number(arg('seed', '1'));

const cats = ['duels', 'coins', 'tower', 'lore', 'trade', 'research', 'patrons'] as const;
const played: Record<string, number> = {};
const won: Record<string, number> = {};
const sum: Record<string, number> = Object.fromEntries(cats.map((c) => [c, 0]));
const winSum: Record<string, number> = Object.fromEntries(cats.map((c) => [c, 0]));
let totalSum = 0;
let winTotal = 0;
let scored = 0;
let winnersCount = 0;

for (let g = 0; g < games; g++) {
  const seats: SeatConfig[] = Array.from({ length: players }, (_, i) => ({ kind: 'bot', name: `B${i}`, botLevel: level }));
  let s = createGame({ seed: seed0 + g, seats });
  while (s.phase !== 'ended') s = resolveTurn(autoPlay(s));
  const scores = finalScores(s).filter((b) => s.players[b.seat].config.kind !== 'archmage');
  const w = new Set(winners(s));
  for (const b of scores) {
    const ac = s.players[b.seat].academyId;
    played[ac] = (played[ac] ?? 0) + 1;
    if (w.has(b.seat)) won[ac] = (won[ac] ?? 0) + 1 / w.size;
    for (const c of cats) sum[c] += b[c];
    totalSum += b.total;
    scored++;
    if (w.has(b.seat)) {
      for (const c of cats) winSum[c] += (b as ScoreBreakdown)[c];
      winTotal += b.total;
      winnersCount++;
    }
  }
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(`games=${games} players=${players} level=${level}`);
console.log('\nWin rate per academy (expected ' + pct(1 / players) + '):');
for (const a of ACADEMIES) {
  const p = played[a.id] ?? 0;
  console.log(`  ${a.id.padEnd(12)} ${p ? pct((won[a.id] ?? 0) / p) : 'n/a'}  (${p} games)`);
}
console.log('\nAverage score per category (all players / winners, share of winning total):');
for (const c of cats) {
  console.log(`  ${c.padEnd(9)} ${(sum[c] / scored).toFixed(1).padStart(5)} / ${(winSum[c] / winnersCount).toFixed(1).padStart(5)}  ${pct(winSum[c] / winTotal)}`);
}
console.log(`\nAverage total: ${(totalSum / scored).toFixed(1)}   winners: ${(winTotal / winnersCount).toFixed(1)}`);
