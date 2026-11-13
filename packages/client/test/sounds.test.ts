import { describe, expect, it, vi } from 'vitest';
import { createSoundBoard, type AudioBackend } from '../src/audio/sounds';

function setup(o: { vibrate?: boolean; reject?: boolean } = {}) {
  const made: { src: string; plays: number; pauses: number; volume: number; loop: boolean; currentTime: number }[] = [];
  const backend: AudioBackend = {
    create(src) {
      const el = {
        src,
        plays: 0,
        pauses: 0,
        volume: 1,
        loop: false,
        currentTime: 0,
        play() {
          el.plays++;
          return o.reject ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
        },
        pause() {
          el.pauses++;
        },
      };
      made.push(el);
      return el;
    },
  };
  let onVisibility = () => {};
  const doc = { hidden: false, addEventListener: (_t: 'visibilitychange', f: () => void) => (onVisibility = f) };
  const vibrate = vi.fn(() => true);
  const board = createSoundBoard({ backend, doc, ...(o.vibrate === false ? {} : { vibrate }) });
  const plays = (src: string) => made.filter((m) => m.src === src).reduce((n, m) => n + m.plays, 0);
  return { board, made, plays, vibrate, doc, visibility: () => onVisibility() };
}

describe('SoundBoard', () => {
  it('stays silent until the first touch unlocks audio', () => {
    const h = setup();
    h.board.play('build');
    h.board.music(true);
    expect(h.plays('/sounds/build.mp3')).toBe(0);
    expect(h.plays('/sounds/music.mp3')).toBe(0);
    h.board.unlock();
    expect(h.plays('/sounds/music.mp3')).toBe(1);
    h.board.play('build');
    expect(h.plays('/sounds/build.mp3')).toBe(1);
  });

  it('respects the Sound effects switch', () => {
    const h = setup();
    h.board.unlock();
    h.board.setPrefs({ music: true, sfx: false, haptics: true });
    h.board.play('sell');
    expect(h.plays('/sounds/sell.mp3')).toBe(0);
  });

  it('vibrates only with Haptics on, and never fails without vibration support', () => {
    const h = setup();
    h.board.unlock();
    h.board.play('build');
    expect(h.vibrate).toHaveBeenCalledWith(20);
    h.board.setPrefs({ music: true, sfx: true, haptics: false });
    h.board.play('build');
    expect(h.vibrate).toHaveBeenCalledTimes(1);
    const ios = setup({ vibrate: false });
    ios.board.unlock();
    expect(() => ios.board.play('duelWin')).not.toThrow();
  });

  it('swallows a blocked play()', async () => {
    const h = setup({ reject: true });
    h.board.unlock();
    h.board.play('tap');
    h.board.music(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.plays('/sounds/tap.mp3')).toBe(1);
  });

  it('music starts once, loops quietly, and keeps playing when asked again', () => {
    const h = setup();
    h.board.unlock();
    h.board.music(true);
    h.board.music(true);
    expect(h.plays('/sounds/music.mp3')).toBe(1);
    const m = h.made.find((x) => x.src === '/sounds/music.mp3')!;
    expect(m.loop).toBe(true);
    expect(m.volume).toBeCloseTo(0.35);
  });

  it('pauses music while the app is hidden and resumes after', () => {
    const h = setup();
    h.board.unlock();
    h.board.music(true);
    const m = h.made.find((x) => x.src === '/sounds/music.mp3')!;
    h.doc.hidden = true;
    h.visibility();
    expect(m.pauses).toBe(1);
    h.doc.hidden = false;
    h.visibility();
    expect(m.plays).toBe(2);
  });

  it('turning Music off pauses it', () => {
    const h = setup();
    h.board.unlock();
    h.board.music(true);
    h.board.setPrefs({ music: false, sfx: true, haptics: true });
    expect(h.made.find((x) => x.src === '/sounds/music.mp3')!.pauses).toBe(1);
  });
});
