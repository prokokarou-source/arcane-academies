/**
 * Player-like profiles for the AI opponents that fill Casual and Ranked tables when few people are online.
 * Built once from word lists with a fixed seed, so the same ~200 handles exist after every restart.
 * They are not accounts: never stored, never on leaderboards; their usernames are reserved so nobody can sign up as one.
 */
import { AVATAR_COLORS, AVATAR_ICONS, USERNAME_RE, type Avatar } from '@arcane/protocol';
import { usernameKey } from './store';

export interface AiProfile {
  username: string;
  avatar: Avatar;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export const AI_POOL_SIZE = 200;

/** Weighted towards Europe and Greece. */
const COUNTRIES: [string, number][] = [
  ['GR', 22], ['CY', 6], ['GB', 9], ['IE', 3], ['US', 9], ['CA', 3], ['DE', 8], ['FR', 7], ['IT', 7], ['ES', 6],
  ['PT', 3], ['NL', 4], ['BE', 3], ['PL', 4], ['SE', 3], ['NO', 2], ['DK', 2], ['FI', 2], ['BR', 4], ['AR', 2],
  ['MX', 2], ['AU', 3], ['TR', 3], ['RO', 3], ['JP', 2], ['KR', 2], ['IN', 2], ['PH', 2],
];

const ADJ = [
  'silent', 'crimson', 'lucky', 'frost', 'grumpy', 'swift', 'sleepy', 'cosmic', 'rusty', 'velvet',
  'hollow', 'brave', 'sneaky', 'golden', 'quiet', 'wild', 'lazy', 'stormy', 'mellow', 'salty',
  'tiny', 'mighty', 'odd', 'shy', 'neon', 'dusty', 'clever', 'misty', 'jolly', 'feral',
  'ashen', 'bold', 'cobalt', 'fuzzy', 'gentle', 'hasty', 'icy', 'nimble', 'rogue', 'sunny',
];
const NOUN = [
  'owl', 'fox', 'raven', 'otter', 'badger', 'comet', 'rook', 'lantern', 'quill', 'goblet',
  'pebble', 'ember', 'falcon', 'moth', 'walrus', 'cactus', 'pickle', 'kettle', 'mango', 'wombat',
  'gecko', 'heron', 'pigeon', 'yak', 'beacon', 'anchor', 'cinder', 'acorn', 'meteor', 'nomad',
  'tinker', 'scribe', 'wizard', 'hermit', 'sparrow', 'lynx', 'puffin', 'bramble', 'thistle', 'domino',
];
/** Short words that make good one-word handles with a number. */
const SOLO = [
  'zephyr', 'nebula', 'vortex', 'echo', 'pixel', 'glyph', 'rune', 'onyx', 'nova', 'drift',
  'quasar', 'cipher', 'karma', 'blitz', 'orbit', 'sable', 'tundra', 'mirage', 'fable', 'jinx',
];

/** Small fixed-seed generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

function handle(r: () => number): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const n2 = () => String(10 + Math.floor(r() * 90));
  const year = () => String(pick([88, 91, 93, 95, 96, 97, 98, 99, 0, 1, 3, 4, 5, 7])).padStart(2, '0');
  switch (Math.floor(r() * 8)) {
    case 0:
      return cap(pick(ADJ)) + cap(pick(NOUN)); // SilentRook
    case 1:
      return `${pick(ADJ)}_${pick(NOUN)}`; // salty_walrus
    case 2:
      return `${pick(NOUN)}${n2()}`; // heron42
    case 3:
      return `${cap(pick(SOLO))}${year()}`; // Nebula97
    case 4:
      return `${pick(SOLO)}_${pick(NOUN)}`; // pixel_otter
    case 5:
      return `x${cap(pick(SOLO))}x`; // xVortexx
    case 6:
      return `${cap(pick(NOUN))}${cap(pick(NOUN))}`; // OwlLantern
    default:
      return `the_${pick(ADJ)}_${pick(NOUN)}`; // the_lazy_moth
  }
}

function build(): AiProfile[] {
  const r = rng(0xa1ca7e);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const totalW = COUNTRIES.reduce((sum, [, w]) => sum + w, 0);
  const country = () => {
    let x = r() * totalW;
    for (const [c, w] of COUNTRIES) if ((x -= w) < 0) return c;
    return 'GR';
  };
  const seen = new Set<string>();
  const out: AiProfile[] = [];
  while (out.length < AI_POOL_SIZE) {
    const username = handle(r);
    const key = usernameKey(username);
    if (!USERNAME_RE.test(username) || seen.has(key)) continue;
    seen.add(key);
    out.push({ username, avatar: { icon: pick(AVATAR_ICONS), color: pick(AVATAR_COLORS) }, country: country() });
  }
  return out;
}

export const AI_PROFILES: readonly AiProfile[] = build();
const BY_KEY = new Map(AI_PROFILES.map((p) => [usernameKey(p.username), p]));

/** The AI profile with this username (any case), if any. */
export const aiProfile = (username: string): AiProfile | undefined => BY_KEY.get(usernameKey(username));
