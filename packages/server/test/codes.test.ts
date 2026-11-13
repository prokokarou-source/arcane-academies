import { describe, expect, it } from 'vitest';
import { CODE_WORDS, generateCode, normalizeCode } from '../src/codes';
import { ManualClock } from '../src/clock';

describe('room codes', () => {
  it('look like WAND-42', () => {
    for (let i = 0; i < 200; i++) expect(generateCode(() => false)).toMatch(/^[A-Z]{4}-[1-9]\d$/);
    expect(CODE_WORDS.length).toBeGreaterThanOrEqual(20);
    for (const w of CODE_WORDS) expect(w).toMatch(/^[A-Z]{4}$/);
  });

  it('skip codes that are taken', () => {
    const first = generateCode(() => false, () => 0);
    const seq = [0, 0, 0.99, 0.99];
    let i = 0;
    const code = generateCode((c) => c === first, () => seq[i++ % seq.length]);
    expect(code).not.toBe(first);
    expect(code).toMatch(/^[A-Z]{4}-[1-9]\d$/);
  });

  it('normalize user input', () => {
    expect(normalizeCode(' wand-42 ')).toBe('WAND-42');
  });
});

describe('ManualClock', () => {
  it('fires timers in order, honours clear, and runs timers scheduled by callbacks', () => {
    const clock = new ManualClock(1000);
    const fired: string[] = [];
    clock.setTimer(20, () => fired.push('b'));
    clock.setTimer(10, () => {
      fired.push('a');
      clock.setTimer(0, () => fired.push('a0'));
    });
    const h = clock.setTimer(15, () => fired.push('never'));
    clock.clearTimer(h);
    clock.advance(9);
    expect(fired).toEqual([]);
    clock.advance(11);
    expect(fired).toEqual(['a', 'a0', 'b']);
    expect(clock.now()).toBe(1020);
  });
});
