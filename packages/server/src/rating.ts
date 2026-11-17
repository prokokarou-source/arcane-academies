/**
 * Ranked rating: Elo, pairwise by finishing place among the humans of one game.
 * With two humans (1v1 + the Archmage, who is ignored) this is plain Elo with K = 32;
 * with n humans every pair counts and K is split: K = 32 / (n - 1).
 */
export const K = 32;

export interface RatedPlayer {
  id: string;
  rating: number;
  /** 1 = first; equal places draw. */
  place: number;
}

/** Expected score of a player rated `a` against one rated `b`. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/** Whole-point rating changes per player id (empty below two players). */
export function ratingDeltas(players: RatedPlayer[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = players.length;
  if (n < 2) return out;
  const k = K / (n - 1);
  for (const p of players) {
    let sum = 0;
    for (const q of players) {
      if (q === p) continue;
      const s = p.place < q.place ? 1 : p.place === q.place ? 0.5 : 0;
      sum += s - expected(p.rating, q.rating);
    }
    out.set(p.id, Math.round(k * sum));
  }
  return out;
}

/** Current and longest run of wins in games listed oldest first. */
export function streaks(wonOldestFirst: boolean[]): { streak: number; bestStreak: number } {
  let run = 0;
  let best = 0;
  for (const w of wonOldestFirst) {
    run = w ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { streak: run, bestStreak: best };
}
