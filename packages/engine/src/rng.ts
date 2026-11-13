/** mulberry32: returns a float in [0, 1) and the next state. Pure. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Fisher–Yates shuffle driven by nextRandom. Returns the new array and the next state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const out = [...items];
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, n] = nextRandom(s);
    s = n;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

/** Random integer in [0, max). */
export function randomInt(max: number, state: number): [number, number] {
  const [r, n] = nextRandom(state);
  return [Math.floor(r * max), n];
}
