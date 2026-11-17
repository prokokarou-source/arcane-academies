import { createGame, autoPlay, resolveTurn, finalScores, winners, ACADEMIES } from '../../engine/src/index';
import type { SeatConfig } from '../../engine/src/index';

/** Win rate per academy and side with Hard bots. Usage: tsx packages/sim/src/balance.ts <players> <games> */
const players = Number(process.argv[2] ?? 4);
const games = Number(process.argv[3] ?? 200);
type Row = { games: number; wins: number; score: number; place: number };
const stats = new Map<string, Row>();
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const side = g % 2 === 0 ? 'A' : 'B';
  const seats: SeatConfig[] = Array.from({ length: players }, (_, i) => ({ kind: 'bot', name: `B${i}`, botLevel: 'hard', side }));
  let s = createGame({ seed: 100000 + g * 7919 + players, seats });
  while (s.phase !== 'ended') s = resolveTurn(autoPlay(s));
  const w = winners(s);
  const sc = finalScores(s);
  for (const r of sc) {
    const p = s.players[r.seat];
    const key = `${p.academyId}|${p.side}`;
    const row = stats.get(key) ?? { games: 0, wins: 0, score: 0, place: 0 };
    row.games++;
    if (w.includes(r.seat)) row.wins += 1 / w.length;
    row.score += r.total;
    row.place += 1 + sc.filter((o) => o.total > r.total).length;
    stats.set(key, row);
  }
}
const name = (id: string) => ACADEMIES.find((a) => a.id === id)?.name ?? id;
const rows = [...stats.entries()]
  .map(([k, r]) => {
    const [id, side] = k.split('|');
    return { academy: name(id), side, games: r.games, winPct: +((100 * r.wins) / r.games).toFixed(1), avgScore: +(r.score / r.games).toFixed(1), avgPlace: +(r.place / r.games).toFixed(2) };
  })
  .sort((a, b) => b.winPct - a.winPct);
console.log(JSON.stringify({ players, games, fair: +(100 / players).toFixed(1), secs: Math.round((Date.now() - t0) / 1000), rows }));
