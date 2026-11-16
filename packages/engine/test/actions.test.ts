import { describe, it, expect } from 'vitest';
import { legalActions, submitAction, resolveTurn, allSubmitted, IllegalActionError } from '../src/actions';
import type { Action, GameState } from '../src/types';
import { asAcademy, fixedGame, withBuilt, withCoins, withHand, withTower } from './helpers';

const sellAll = (s: GameState, except: number[] = []) =>
  s.players.reduce((acc, p) => (except.includes(p.seat) ? acc : submitAction(acc, p.seat, { type: 'sell', cardUid: p.hand[0].uid })), s);
const find = (s: GameState, seat: number, type: Action['type'], defId: string) =>
  legalActions(s, seat).find((a) => a.type === type && a.cardUid.startsWith(defId + '#'))!;
const fill = (id: string) => Array(6).fill(id) as string[];

describe('actions', () => {
  it('sell gives 3 coins and archives the card', () => {
    const s0 = fixedGame();
    const uid = s0.players[0].hand[0].uid;
    const s = resolveTurn(sellAll(s0));
    expect(s.players[0].coins).toBe(6);
    expect(s.archive.map((c) => c.uid)).toContain(uid);
  });

  it('build moves the card to built and pays the neighbor after resolve', () => {
    let s = withHand(fixedGame(), 0, ['t1-candle-chapel', ...fill('t1-alms-box')]);
    const a = find(s, 0, 'build', 't1-candle-chapel'); // needs herbs, bought from seat2 on the left
    expect(a).toBeDefined();
    s = submitAction(s, 0, a);
    expect(s.players[2].coins).toBe(3);
    s = resolveTurn(sellAll(s, [0]));
    expect(s.players[0].built.map((c) => c.defId)).toContain('t1-candle-chapel');
    expect(s.players[0].coins).toBe(1);
    expect(s.players[2].coins).toBe(3 + 3 + 2);
  });

  it('coins received this turn cannot fund this turn', () => {
    let s = withCoins(fixedGame(), 2, 0);
    s = withHand(s, 2, ['t1-practice-yard', ...fill('t1-alms-box')]);
    expect(legalActions(s, 2).some((a) => a.type === 'build' && a.cardUid.startsWith('t1-practice-yard'))).toBe(false);
  });

  it('duplicate name not offered', () => {
    let s = withBuilt(fixedGame(), 0, ['t1-alms-box']);
    s = withHand(s, 0, ['t1-alms-box', ...fill('t1-iron-seam')]);
    expect(legalActions(s, 0).some((a) => a.type === 'build' && a.cardUid.startsWith('t1-alms-box'))).toBe(false);
  });

  it('tower stage increments, applies effects, card hidden', () => {
    let s = withBuilt(fixedGame(), 0, ['t1-mandrake-bed', 't1-mandrake-bed']); // pyromancy stage 1 needs herbs 2
    const uid = s.players[0].hand[0].uid;
    s = submitAction(s, 0, legalActions(s, 0).find((a) => a.type === 'tower' && a.cardUid === uid)!);
    s = resolveTurn(sellAll(s, [0]));
    expect(s.players[0].towerStages).toBe(1);
    expect(s.players[0].towerCards.map((c) => c.uid)).toEqual([uid]);
    expect(s.players[0].built.map((c) => c.uid)).not.toContain(uid);
  });

  it('hands pass left in Term 1 and right in Term 2', () => {
    const s0 = fixedGame();
    const s1 = resolveTurn(sellAll(s0));
    expect(s1.players[2].hand.map((c) => c.uid)).toEqual(s0.players[0].hand.slice(1).map((c) => c.uid));
    let s = s1;
    while (s.term === 1) s = resolveTurn(sellAll(s));
    const before = s.players[0].hand.slice(1).map((c) => c.uid);
    s = resolveTurn(sellAll(s));
    expect(s.players[1].hand.map((c) => c.uid)).toEqual(before);
  });

  it('after turn 6 the 7th card is archived and the next term deals', () => {
    let s = fixedGame();
    for (let t = 0; t < 6; t++) s = resolveTurn(sellAll(s));
    expect(s.term).toBe(2);
    expect(s.turn).toBe(1);
    expect(s.archive).toHaveLength(21);
    for (const p of s.players) expect(p.hand).toHaveLength(7);
  });

  it('game ends after term 3', () => {
    let s = fixedGame();
    for (let t = 0; t < 18; t++) s = resolveTurn(sellAll(s));
    expect(s.phase).toBe('ended');
    expect(legalActions(s, 0)).toEqual([]);
  });

  it('illegal action throws IllegalActionError', () => {
    expect(() => submitAction(fixedGame(), 0, { type: 'sell', cardUid: 'nope' })).toThrow(IllegalActionError);
  });

  it('allSubmitted', () => {
    const s = fixedGame();
    expect(allSubmitted(s)).toBe(false);
    expect(allSubmitted(sellAll(s))).toBe(true);
  });

  it('playLastCard (Verdant B): the last card of the Term is played in a bonus turn', () => {
    let s = asAcademy(fixedGame(), 2, 'verdant', 'B');
    s = withTower(s, 2, 1);
    for (let t = 1; t <= 6; t++) s = resolveTurn(sellAll(s));
    expect(s.phase).toBe('bonus');
    expect(s.term).toBe(1);
    expect(legalActions(s, 0)).toEqual([]);
    const last = s.kept[2]!;
    const sell = legalActions(s, 2).find((a) => a.type === 'sell')!;
    expect(sell.cardUid).toBe(last.uid);
    s = resolveTurn(submitAction(s, 2, sell));
    expect(s.term).toBe(2);
    expect(s.phase).toBe('picking');
    expect(s.kept[2]).toBeNull();
    expect(s.archive.map((c) => c.uid)).toContain(last.uid);
  });

  it('freeFirstTurn (Shadow B): turn 1 builds are free', () => {
    let s = asAcademy(fixedGame(), 0, 'shadow', 'B');
    s = withTower(withCoins(s, 0, 0), 0, 1);
    s = withHand(s, 0, ['t1-candle-chapel', ...fill('t1-alms-box')]);
    const a = find(s, 0, 'build', 't1-candle-chapel');
    expect(a.type === 'build' && a.payment.free).toBe(true);
    s = resolveTurn(sellAll(submitAction(s, 0, a), [0]));
    expect(s.players[0].built.map((c) => c.defId)).toContain('t1-candle-chapel');
    expect(s.players[0].coins).toBe(0);
  });

  it('freeNewFamily (Shadow A): free only for a family you do not own yet', () => {
    let s = asAcademy(fixedGame(), 0, 'shadow', 'A');
    s = withTower(withCoins(s, 0, 0), 0, 2);
    s = withBuilt(s, 0, ['t1-reading-hall']); // a lore card
    s = withHand(s, 0, ['t1-candle-chapel', 't1-practice-yard', ...Array(5).fill('t1-alms-box')]);
    const lore = legalActions(s, 0).find((a) => a.type === 'build' && a.cardUid.startsWith('t1-candle-chapel#'));
    const duel = find(s, 0, 'build', 't1-practice-yard');
    expect(lore).toBeUndefined(); // lore owned, no coins to buy herbs
    expect(duel.type === 'build' && duel.payment.free).toBe(true);
  });

  it('tower coins are paid when the level is built (Runeforge A level 2: 9 coins)', () => {
    let s = asAcademy(fixedGame(), 0, 'runeforge', 'A');
    s = withTower(withBuilt(s, 0, ['t1-mandrake-bed', 't1-mandrake-bed']), 0, 1);
    const a = legalActions(s, 0).find((x) => x.type === 'tower')!;
    s = resolveTurn(sellAll(submitAction(s, 0, a), [0]));
    expect(s.players[0].towerStages).toBe(2);
    expect(s.players[0].coins).toBe(3 + 9);
  });

  it('buildDiscard (Chronomancy A): build a discarded card free right after the level', () => {
    let s = asAcademy(fixedGame(), 0, 'chronomancy', 'A');
    s = withTower(withBuilt(s, 0, ['t1-starshard-kiln', 't1-dragon-roost']), 0, 1);
    s = { ...s, archive: [{ uid: 't1-reading-hall#z', defId: 't1-reading-hall' }] };
    const a = legalActions(s, 0).find((x) => x.type === 'tower')!;
    s = resolveTurn(sellAll(submitAction(s, 0, a), [0]));
    expect(s.phase).toBe('discard');
    expect(legalActions(s, 1)).toEqual([]);
    const picks = legalActions(s, 0);
    expect(picks.every((p) => p.type === 'build' && p.payment.free)).toBe(true);
    const pick = picks.find((p) => p.cardUid === 't1-reading-hall#z')!;
    s = resolveTurn(submitAction(s, 0, pick));
    expect(s.players[0].built.map((c) => c.uid)).toContain('t1-reading-hall#z');
    expect(s.archive.map((c) => c.uid)).not.toContain('t1-reading-hall#z');
    expect(s.phase).toBe('picking');
    expect(s.turn).toBe(2);
  });

  it('buildDiscard is lost when the pile has nothing to take', () => {
    let s = asAcademy(fixedGame(), 0, 'chronomancy', 'A');
    s = withTower(withBuilt(s, 0, ['t1-starshard-kiln', 't1-dragon-roost']), 0, 1);
    s = withHand(s, 1, ['t1-starshard-kiln', ...fill('t1-alms-box')]);
    s = withHand(s, 2, ['t1-dragon-roost', ...fill('t1-alms-box')]);
    const a = legalActions(s, 0).find((x) => x.type === 'tower')!;
    // the others sell cards seat 0 already owns, so nothing in the pile can be taken
    s = resolveTurn(sellAll(submitAction(s, 0, a), [0]));
    expect(s.phase).toBe('picking');
    expect(s.turn).toBe(2);
  });
});

describe('final review fixes', () => {
  it('accepts an alternative valid payment from the other side at the same price', () => {
    let s = withBuilt(fixedGame(), 0, ['t1-iron-seam']);
    s = withBuilt(s, 2, ['t1-iron-seam']);
    s = withHand(s, 1, ['t1-practice-yard', ...fill('t1-alms-box')]);
    const offered = find(s, 1, 'build', 't1-practice-yard');
    expect(offered.type === 'build' && offered.payment.buyLeft).toEqual({ ore: 1 });
    const alt: Action = {
      type: 'build',
      cardUid: offered.cardUid,
      payment: { free: false, coinsToBank: 0, coinsToRight: 2, coinsToLeft: 0, buyRight: { ore: 1 }, buyLeft: {} },
    };
    s = resolveTurn(sellAll(submitAction(s, 1, alt), [1]));
    expect(s.players[2].coins).toBe(3 + 3 + 2);
  });

  it('rejects an invalid payment', () => {
    const s = withHand(fixedGame(), 0, ['t1-candle-chapel', ...fill('t1-alms-box')]);
    const offered = find(s, 0, 'build', 't1-candle-chapel');
    const under: Action = { ...offered, payment: { ...(offered as Extract<Action, { type: 'build' }>).payment, coinsToLeft: 0 } } as Action;
    expect(() => submitAction(s, 0, under)).toThrow(IllegalActionError);
    const phantom: Action = { ...offered, payment: { free: false, coinsToBank: 0, coinsToLeft: 0, coinsToRight: 0, buyLeft: {}, buyRight: {} } } as Action;
    expect(() => submitAction(s, 0, phantom)).toThrow(IllegalActionError);
  });

  it('a coin received this turn cannot fund a purchase in the same turn', () => {
    // seat0 (3 coins) buys herbs from seat2 (left, 0 coins). seat2 cannot buy ore from seat0 with that money.
    let s = withCoins(fixedGame(), 2, 0);
    s = withHand(s, 0, ['t1-candle-chapel', ...fill('t1-alms-box')]);
    s = withHand(s, 2, ['t1-practice-yard', ...fill('t1-alms-box')]);
    s = submitAction(s, 0, find(s, 0, 'build', 't1-candle-chapel'));
    const crafted: Action = {
      type: 'build',
      cardUid: s.players[2].hand[0].uid,
      payment: { free: false, coinsToBank: 0, coinsToLeft: 0, coinsToRight: 2, buyLeft: {}, buyRight: { ore: 1 } },
    };
    expect(() => submitAction(s, 2, crafted)).toThrow(IllegalActionError);
    s = resolveTurn(sellAll(s, [0]));
    expect(s.players[2].coins).toBe(0 + 3 + 2);
  });

  it('resolveTurn refuses a pending action that would make coins negative', () => {
    const s = fixedGame();
    const bad = {
      ...s,
      players: s.players.map((p) => ({
        ...p,
        pending: { type: 'build', cardUid: p.hand[0].uid, payment: { free: false, coinsToBank: 9, coinsToLeft: 0, coinsToRight: 0, buyLeft: {}, buyRight: {} } } as Action,
      })),
    };
    expect(() => resolveTurn(bad)).toThrow(IllegalActionError);
  });
});
