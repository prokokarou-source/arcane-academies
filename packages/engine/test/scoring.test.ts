import { describe, it, expect } from 'vitest';
import { scoreResearch, finalScores, winners } from '../src/scoring';
import { createGame } from '../src/setup';
import { fixedGame, withBuilt, withCoins, seats } from './helpers';

describe('scoring', () => {
  it('research', () => {
    expect(scoreResearch({ alchemy: 3, astronomy: 2, runes: 1 }, false)).toBe(23);
    expect(scoreResearch({ alchemy: 3, astronomy: 3, runes: 3 }, false)).toBe(51);
    expect(scoreResearch({ alchemy: 0, astronomy: 0, runes: 0 }, false)).toBe(0);
    expect(scoreResearch({ alchemy: 1, astronomy: 1, runes: 1 }, true)).toBe(15);
  });

  it('coins: 1 per 3', () => {
    const s = withCoins(fixedGame(), 0, 8);
    expect(finalScores(s)[0].coins).toBe(2);
  });

  it('lore and research from built cards', () => {
    const s = withBuilt(fixedGame(), 0, ['t1-reading-hall', 't1-herbalist-lab', 't1-stargazer-loft', 't1-rune-desk']);
    const b = finalScores(s)[0];
    expect(b.lore).toBe(3);
    expect(b.research).toBe(2 * 3 + 6);
  });

  it('renownPer with scope neighbors counts only neighbor cards', () => {
    let s = withBuilt(fixedGame(), 0, ['t3-rivalry-board#0'.replace('#0', ''), 't1-practice-yard']);
    s = withBuilt(s, 1, ['t1-ward-circle']);
    s = withBuilt(s, 2, ['t1-reading-hall']);
    expect(finalScores(s)[0].patrons).toBe(2); // 1 duel (seat1) + 1 lore (seat2), own duel card ignored
  });

  it('archmage never wins', () => {
    let s = createGame({ seed: 4, seats: seats(2) });
    s = withCoins(s, 1, 99);
    expect(winners(s)).not.toContain(1);
  });

  it('tie broken by coins, full tie shared', () => {
    let s = fixedGame();
    s = withCoins(withCoins(withCoins(s, 0, 4), 1, 5), 2, 3); // all 1 Renown from coins
    expect(winners(s)).toEqual([1]);
    s = withCoins(withCoins(withCoins(s, 0, 3), 1, 3), 2, 3);
    expect(winners(s)).toEqual([0, 1, 2]);
  });
});
