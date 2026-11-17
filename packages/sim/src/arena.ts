import { createGame, botPick, archmagePick, resolveTurn, submitAction, actingSeats, finalScores, winners } from '../../engine/src/index';
import type { Action, BotLevel, GameState, SeatConfig } from '../../engine/src/index';
import { hardV1Pick } from './hardV1';
import { HARD_WEIGHTS } from '../../engine/src/bots/hard';

/**
 * Head-to-head bot arena: two levels share every table, seats alternate and the pattern is
 * rotated each game so neither level keeps a seat or academy advantage.
 * Levels: easy | normal | hard | hardV1 (the Hard bot before the 2026-11 rewrite).
 * Usage: npm run arena -- --a hard --b normal --games 200 --players 4
 * Tuning: --w '{"deny":0.6}' overrides Hard weights for this run.
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const a = arg('a', 'hard');
const b = arg('b', 'normal');
const games = Number(arg('games', '200'));
const players = Number(arg('players', '4'));
const seed0 = Number(arg('seed', '1'));
Object.assign(HARD_WEIGHTS, JSON.parse(arg('w', '{}')));

type Pick = (s: GameState, seat: number) => Action;
const pickOf = (name: string): Pick => (name === 'hardV1' ? hardV1Pick : (s, seat) => botPick(s, seat, name as BotLevel));
const picks: Record<string, Pick> = { [a]: pickOf(a), [b]: pickOf(b) };
const pickTime: Record<string, { n: number; ms: number; max: number }> = { [a]: { n: 0, ms: 0, max: 0 }, [b]: { n: 0, ms: 0, max: 0 } };

const score = { [a]: 0, [b]: 0 } as Record<string, number>;
const seatsOf = { [a]: 0, [b]: 0 } as Record<string, number>;
const wins = { [a]: 0, [b]: 0 } as Record<string, number>;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const labels = Array.from({ length: players }, (_, i) => ((i + g) % 2 === 0 ? a : b));
  const cfg: SeatConfig[] = labels.map((lv, i) => ({ kind: 'bot', name: `B${i}`, botLevel: (lv === 'hardV1' ? 'hard' : lv) as BotLevel }));
  let s = createGame({ seed: seed0 + g, seats: cfg });
  // With 2 seats an archmage sits at index 1.
  const labelOf = (seat: number) => (s.players[seat].config.kind === 'archmage' ? null : labels[cfg.indexOf(s.players[seat].config)]);
  while (s.phase !== 'ended') {
    let next = s;
    for (const seat of actingSeats(s)) {
      const lv = labelOf(seat);
      if (!lv) {
        next = submitAction(next, seat, archmagePick(s, seat));
        continue;
      }
      const t = performance.now();
      const act = picks[lv](s, seat);
      const dt = performance.now() - t;
      pickTime[lv].n++;
      pickTime[lv].ms += dt;
      pickTime[lv].max = Math.max(pickTime[lv].max, dt);
      next = submitAction(next, seat, act);
    }
    s = resolveTurn(next);
  }
  const w = winners(s);
  for (const sc of finalScores(s)) {
    const lv = labelOf(sc.seat);
    if (!lv) continue;
    score[lv] += sc.total;
    seatsOf[lv]++;
  }
  for (const seat of w) wins[labelOf(seat)!] += 1 / w.length;
}
for (const lv of [a, b]) {
  const pt = pickTime[lv];
  console.log(
    `${lv.padEnd(7)} avg ${(score[lv] / seatsOf[lv]).toFixed(2)}  wins ${wins[lv].toFixed(1)}/${games} (${((100 * wins[lv]) / games).toFixed(1)}%)  pick ${(pt.ms / pt.n).toFixed(2)} ms avg, ${pt.max.toFixed(1)} max`,
  );
}
console.log(`${games} games, ${players} players, ${((Date.now() - t0) / games).toFixed(1)} ms/game`);
