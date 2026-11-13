/**
 * Plays sound effects, the music loop and vibrations. Nothing sounds before the first touch (iOS requires it),
 * music pauses while the app is hidden, and every switch in Settings is respected.
 * Each cue is the file /sounds/<cue>.mp3, so sounds can be replaced without touching code.
 */
import type { Cue } from './cues';

export interface AudioLike {
  play(): Promise<void> | void;
  pause(): void;
  volume: number;
  loop: boolean;
  currentTime: number;
}

export interface AudioBackend {
  create(src: string): AudioLike;
}

export interface SoundPrefs {
  music: boolean;
  sfx: boolean;
  haptics: boolean;
}

const MUSIC_SRC = '/sounds/music.mp3';
const MUSIC_VOLUME = 0.35;
const SFX_VOLUME = 0.8;
const HAPTICS: Partial<Record<Cue, number | number[]>> = {
  select: 10,
  build: 20,
  tower: 20,
  sell: 20,
  duelWin: [30, 40, 60],
  victory: [30, 40, 60],
  duelLoss: 80,
};

export function createSoundBoard(opts: {
  backend: AudioBackend;
  vibrate?: (pattern: number | number[]) => boolean;
  doc: { hidden: boolean; addEventListener(type: 'visibilitychange', fn: () => void): void };
}) {
  const { backend, vibrate, doc } = opts;
  let prefs: SoundPrefs = { music: true, sfx: true, haptics: true };
  let unlocked = false;
  let musicWanted = false;
  let musicPlaying = false;
  let musicEl: AudioLike | null = null;
  const effects = new Map<Cue, AudioLike>();

  const safePlay = (el: AudioLike) => {
    try {
      const r = el.play();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      // audio is a nicety; never let it break the game
    }
  };

  const syncMusic = () => {
    const should = musicWanted && prefs.music && unlocked && !doc.hidden;
    if (should && !musicPlaying) {
      if (!musicEl) {
        musicEl = backend.create(MUSIC_SRC);
        musicEl.loop = true;
        musicEl.volume = MUSIC_VOLUME;
      }
      musicPlaying = true;
      safePlay(musicEl);
    } else if (!should && musicPlaying && musicEl) {
      musicPlaying = false;
      musicEl.pause();
    }
  };

  doc.addEventListener('visibilitychange', syncMusic);

  return {
    /** Call on the first user gesture. */
    unlock() {
      if (unlocked) return;
      unlocked = true;
      syncMusic();
    },
    play(cue: Cue) {
      const pattern = HAPTICS[cue];
      if (prefs.haptics && vibrate && pattern !== undefined) {
        try {
          vibrate(pattern);
        } catch {
          // unsupported
        }
      }
      if (!unlocked || !prefs.sfx) return;
      let el = effects.get(cue);
      if (!el) {
        el = backend.create(`/sounds/${cue}.mp3`);
        el.volume = SFX_VOLUME;
        effects.set(cue, el);
      }
      el.currentTime = 0;
      safePlay(el);
    },
    music(on: boolean) {
      musicWanted = on;
      syncMusic();
    },
    setPrefs(p: SoundPrefs) {
      prefs = { music: p.music, sfx: p.sfx, haptics: p.haptics };
      syncMusic();
    },
  };
}

export type SoundBoard = ReturnType<typeof createSoundBoard>;

/** The real backend: one HTMLAudioElement per file, preloaded. */
export const htmlAudio: AudioBackend = {
  create(src) {
    const a = new Audio(src);
    a.preload = 'auto';
    return a;
  },
};
