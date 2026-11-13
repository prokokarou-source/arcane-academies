import { describe, it, expect } from 'vitest';
import { planPayment, tradePrice, leftOf, rightOf } from '../src/payment';
import { fixedGame, withBuilt, withCoins } from './helpers';

// seat0 home ore; left of 0 = seat2 (herbs home), right of 0 = seat1 (moonstone home)
describe('payment', () => {
  it('neighbors', () => {
    const s = fixedGame();
    expect(leftOf(s, 0)).toBe(2);
    expect(rightOf(s, 0)).toBe(1);
  });

  it('own production covers cost', () => {
    const plan = planPayment(fixedGame(), 0, { resources: { ore: 1 } });
    expect(plan).not.toBeNull();
    expect(plan!.coinsToLeft + plan!.coinsToRight + plan!.coinsToBank).toBe(0);
  });

  it('choice card used correctly', () => {
    // seat1 (moonstone home) owns only a herbs/ore choice card; neighbors make ore (seat0) and herbs (seat2)
    let s = withBuilt(fixedGame(), 1, ['t1-root-and-rock-dig']);
    s = withCoins(s, 1, 0);
    expect(planPayment(s, 1, { resources: { herbs: 1, ore: 1 } })).toBeNull();
    expect(planPayment(s, 1, { resources: { herbs: 1 } })).not.toBeNull();
  });

  it('buys missing unit from neighbor for 2', () => {
    const plan = planPayment(fixedGame(), 0, { resources: { herbs: 1 } });
    expect(plan!.buyLeft).toEqual({ herbs: 1 });
    expect(plan!.coinsToLeft).toBe(2);
  });

  it('discount makes it 1', () => {
    const s = withBuilt(fixedGame(), 0, ['t1-westwind-courier']);
    expect(tradePrice(s, 0, 'left', 'herbs')).toBe(1);
    expect(planPayment(s, 0, { resources: { herbs: 1 } })!.coinsToLeft).toBe(1);
  });

  it('cannot buy from neighbor trade card production', () => {
    // seat2 owns Grand Exchange (any basic via trade card); ink not produced by anyone else
    const s = withBuilt(fixedGame(), 2, ['t2-grand-exchange']);
    expect(planPayment(s, 0, { resources: { ink: 1 } })).toBeNull();
    // but seat2 itself may use it
    expect(planPayment(s, 2, { resources: { ink: 1 } })).not.toBeNull();
  });

  it('unaffordable returns null', () => {
    const s = withCoins(fixedGame(), 0, 1);
    expect(planPayment(s, 0, { resources: { herbs: 1 } })).toBeNull();
  });

  it('coin cost goes to bank and must be affordable', () => {
    expect(planPayment(fixedGame(), 0, { coins: 1 })!.coinsToBank).toBe(1);
    expect(planPayment(withCoins(fixedGame(), 0, 0), 0, { coins: 1 })).toBeNull();
  });

  it('chain makes it free', () => {
    const s = withCoins(withBuilt(fixedGame(), 0, ['t1-reading-hall']), 0, 0);
    const plan = planPayment(s, 0, { resources: { ink: 2, essence: 1 } }, ['Reading Hall']);
    expect(plan!.free).toBe(true);
  });

  it('picks cheapest side', () => {
    // both neighbors make ore; seat1 has Eastwind (right discount): seat1's right is seat2
    let s = withBuilt(fixedGame(), 0, ['t1-iron-seam']);
    s = withBuilt(s, 2, ['t1-iron-seam']);
    s = withBuilt(s, 1, ['t1-eastwind-courier']);
    const plan = planPayment(s, 1, { resources: { ore: 1 } });
    expect(plan!.buyRight).toEqual({ ore: 1 });
    expect(plan!.coinsToRight).toBe(1);
  });

  it('ties prefer left', () => {
    let s = withBuilt(fixedGame(), 0, ['t1-iron-seam']);
    s = withBuilt(s, 2, ['t1-iron-seam']);
    const plan = planPayment(s, 1, { resources: { ore: 1 } });
    expect(plan!.buyLeft).toEqual({ ore: 1 });
  });

  it('mixes own choice production with purchases optimally', () => {
    // seat0: ore home + herbs/ore choice. Needs ore 2 + herbs 1 -> must buy herbs (2 coins) or buy ore... cheapest = 2
    const s = withBuilt(fixedGame(), 0, ['t1-root-and-rock-dig']);
    const plan = planPayment(s, 0, { resources: { ore: 2, herbs: 1 } });
    expect(plan!.coinsToLeft + plan!.coinsToRight).toBe(2);
  });
});
