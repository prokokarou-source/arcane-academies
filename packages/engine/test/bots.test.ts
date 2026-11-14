import { describe, it, expect } from 'vitest';
import { archmagePick } from '../src/bots/archmage';
import { botPick, autoPlay } from '../src/bots/bot';
import { legalActions, resolveTurn, allSubmitted, submitAction } from '../src/actions';
import { createGame } from '../src/setup';
import { finalScores, winners } from '../src/scoring';
import type { BotLevel, GameState, SeatConfig } from '../src/types';
import { fixedGame, withBuilt, withCoins, withHand, seats } from './helpers';

const fill = (id: string) => Array(6).fill(id) as string[];

describe('archmage', () => {
  it('takes a duel card when behind a neighbor', () => {
    let s = withBuilt(fixedGame(), 0, ['t1-practice-yard']); // seat1 neighbors seat0 (1 power) and seat2
    s = withHand(s, 1, ['t1-founders-statue', 't1-ward-circle', ...Array(5).fill('t1-alms-box')]);
    const a = archmagePick(s, 1);
    expect(a.type).toBe('build');
    expect(a.cardUid.startsWith('t1-ward-circle')).toBe(true);
  });

  it('takes the most expensive affordable card otherwise', () => {
    let s = withHand(fixedGame(), 1, ['t1-founders-statue', 't1-steam-hall', ...fill('t1-alms-box').slice(1), 't1-alms-box']);
    const a = archmagePick(s, 1);
    expect(a.cardUid.startsWith('t1-steam-hall')).toBe(true); // costs 1 moonstone vs free
  });

  it('sells when nothing is affordable', () => {
    let s = withCoins(fixedGame(), 1, 0);
    s = withHand(s, 1, ['t2-celestial-dome'.replace('t2', 't3'), ...fill('t3-archmage-palace')]);
    const a = archmagePick(s, 1);
    expect(a.type).toBe('sell');
  });
});

describe('bots', () => {
  const states: GameState[] = [];
  let s = createGame({ seed: 11, seats: seats(4) });
  while (s.phase !== 'ended' && states.length < 50) {
    states.push(s);
    s = resolveTurn(autoPlay(s));
  }

  it('every level always returns a legal action', () => {
    for (const st of states) {
      for (const level of ['easy', 'normal', 'hard'] as const) {
        for (const p of st.players) {
          const a = botPick(st, p.seat, level);
          // Hard may reroute a trade to the other neighbor, so check the pick is accepted rather than identical.
          expect(legalActions(st, p.seat).some((x) => x.type === a.type && x.cardUid === a.cardUid)).toBe(true);
          expect(() => submitAction(st, p.seat, a)).not.toThrow();
        }
      }
    }
  });

  it('bots are deterministic for the same state', () => {
    for (const level of ['easy', 'normal', 'hard'] as const) {
      expect(botPick(states[3], 2, level)).toEqual(botPick(states[3], 2, level));
    }
  });

  it('autoPlay submits for every non-human seat', () => {
    const cfg = seats(3);
    cfg[0] = { kind: 'human', name: 'Me' };
    const g = autoPlay(createGame({ seed: 2, seats: cfg }));
    expect(g.players[0].pending).toBeUndefined();
    expect(g.players[1].pending).toBeDefined();
    expect(allSubmitted(g)).toBe(false);
  });
});

describe('hard bot', () => {
  it('takes the card the next player needs to finish a research set', () => {
    // Seat0 passes to seat2 in Term I; seat2 already has alchemy + astronomy.
    let s = withBuilt(fixedGame(), 2, ['t1-herbalist-lab', 't1-stargazer-loft']);
    s = withHand(s, 0, ['t1-rune-desk', 't1-cauldron-room', ...Array(5).fill('t1-founders-statue')]);
    expect(botPick(s, 0, 'normal').cardUid.startsWith('t1-cauldron-room')).toBe(true); // free for seat0
    expect(botPick(s, 0, 'hard').cardUid.startsWith('t1-rune-desk')).toBe(true); // denies seat2 its set
  });

  it('buys from the weaker neighbor when both sell at the same price', () => {
    let s = withBuilt(fixedGame(), 0, ['t2-moon-fountain', 't3-archmage-palace']); // seat0 (left of seat1) is ahead
    s = withBuilt(s, 2, ['t1-iron-seam']);
    s = withHand(s, 1, Array(7).fill('t1-practice-yard'));
    const a = botPick(s, 1, 'hard');
    expect(a.type).toBe('build');
    if (a.type !== 'build') return;
    expect(a.payment.buyRight).toEqual({ ore: 1 });
    expect(a.payment.coinsToLeft).toBe(0);
    expect(() => submitAction(s, 1, a)).not.toThrow();
  });

  it('beats Normal on average over seeded games', () => {
    const score: Record<string, number> = { hard: 0, normal: 0 };
    const won: Record<string, number> = { hard: 0, normal: 0 };
    const games = 40;
    for (let g = 0; g < games; g++) {
      const n = 3 + (g % 3);
      // Seats alternate and the pattern flips every game, so neither level keeps a seat.
      const cfg: SeatConfig[] = Array.from({ length: n }, (_, i) => ({ kind: 'bot', name: `B${i}`, botLevel: ((i + g) % 2 === 0 ? 'hard' : 'normal') as BotLevel }));
      let st = createGame({ seed: 1000 + g, seats: cfg });
      while (st.phase !== 'ended') st = resolveTurn(autoPlay(st));
      const levels = st.players.map((p) => p.config.botLevel!);
      const totals = finalScores(st).map((b) => b.total);
      for (const lv of ['hard', 'normal']) {
        const mine = totals.filter((_, i) => levels[i] === lv);
        score[lv] += mine.reduce((a, b) => a + b, 0) / mine.length;
      }
      const w = winners(st);
      for (const seat of w) won[levels[seat]] += 1 / w.length;
    }
    expect(score.hard / games).toBeGreaterThan(score.normal / games + 3);
    expect(won.hard).toBeGreaterThan(games * 0.65);
  });
});
