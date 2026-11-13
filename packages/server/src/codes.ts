/** Short, readable room codes like WAND-42. */
export const CODE_WORDS: readonly string[] = [
  'WAND', 'RUNE', 'MAGE', 'SAGE', 'MYTH', 'STAR', 'MOON', 'TOME',
  'ORBS', 'VEIL', 'MIST', 'HEXE', 'OWLS', 'COVE', 'DUSK', 'GLOW',
  'SEER', 'WISP', 'AURA', 'LORE', 'FATE', 'OMEN', 'IRIS', 'NOVA',
];

/** Pick a random code not yet taken. `random` returns [0, 1). */
export function generateCode(taken: (code: string) => boolean, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const word = CODE_WORDS[Math.floor(random() * CODE_WORDS.length)];
    const num = 10 + Math.floor(random() * 90);
    const code = `${word}-${num}`;
    if (!taken(code)) return code;
  }
  throw new Error('No free room code');
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}
