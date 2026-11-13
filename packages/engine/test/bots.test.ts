import { describe, it, expect } from 'vitest';
import { archmagePick } from '../src/bots/archmage';
import { botPick, autoPlay } from '../src/bots/bot';
import { legalActions, resolveTurn, allSubmitted } from '../src/actions';
import { createGame } from '../src/setup';
import type { GameState } from '../src/types';
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
          expect(legalActions(st, p.seat).map((x) => JSON.stringify(x))).toContain(JSON.stringify(a));
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
