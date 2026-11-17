// Self-play tuning: new Hard (with --w weight overrides) vs --b (default hardV1) at 3, 4 and 7 players on fixed seeds.
// Usage: npx tsx packages/sim/src/tune.ts --games 250 --w '{"block":2.4}'
import { createGame, botPick, archmagePick, resolveTurn, submitAction, actingSeats, finalScores, winners } from '../../engine/src/index';
import type { Action, BotLevel, GameState, SeatConfig } from '../../engine/src/index';
import { HARD_WEIGHTS } from '../../engine/src/bots/hard';
import { hardV1Pick } from './hardV1';
const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const w = arg('w', '{}');
Object.assign(HARD_WEIGHTS, JSON.parse(w));
const games = Number(arg('games', '300'));
const opp = arg('b', 'hardV1');
const oppPick = (s: GameState, x: number): Action => (opp === 'hardV1' ? hardV1Pick(s, x) : botPick(s, x, opp as BotLevel));
const out: string[] = [];
let diffSum = 0, winSum = 0;
for (const players of [3, 4, 7]) {
  let diff = 0, wins = 0;
  for (let g = 0; g < games; g++) {
    const isA = Array.from({ length: players }, (_, i) => (i + g) % 2 === 0);
    const cfg: SeatConfig[] = isA.map((_, i) => ({ kind: 'bot', name: `B${i}`, botLevel: 'hard' }));
    let s = createGame({ seed: 9000 + g, seats: cfg });
    while (s.phase !== 'ended') {
      let next = s;
      for (const seat of actingSeats(s)) next = submitAction(next, seat, isA[seat] ? botPick(s, seat, 'hard') : oppPick(s, seat));
      s = resolveTurn(next);
    }
    const sc = finalScores(s);
    const a = sc.filter((b) => isA[b.seat]), b = sc.filter((x) => !isA[x.seat]);
    diff += a.reduce((x, y) => x + y.total, 0) / a.length - b.reduce((x, y) => x + y.total, 0) / b.length;
    const ws = winners(s);
    for (const x of ws) if (isA[x]) wins += 1 / ws.length;
  }
  out.push(`${players}p ${(diff / games).toFixed(2)} ${((100 * wins) / games).toFixed(1)}%`);
  diffSum += diff / games; winSum += (100 * wins) / games;
}
console.log(`${(diffSum / 3).toFixed(2)} ${(winSum / 3).toFixed(1)}% | ${out.join(' | ')} | ${w}`);
