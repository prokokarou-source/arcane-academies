import { describe, it, expect } from 'vitest';
import { viewFor } from '../src/view';
import { submitAction } from '../src/actions';
import { fixedGame } from './helpers';

describe('view', () => {
  const s = fixedGame();
  it('own hand visible', () => {
    expect(viewFor(s, 0).players[0].hand).toEqual(s.players[0].hand);
  });
  it('other hands absent', () => {
    const json = JSON.stringify(viewFor(s, 0));
    for (const seat of [1, 2]) for (const c of s.players[seat].hand) expect(json).not.toContain(c.uid);
    expect(viewFor(s, 0).players[1].handSize).toBe(7);
  });
  it('no seed or rngState', () => {
    const v = viewFor(s, 0) as unknown as Record<string, unknown>;
    expect(v.seed).toBeUndefined();
    expect(v.rngState).toBeUndefined();
  });
  it('pending hidden, hasSubmitted shown', () => {
    const t = submitAction(s, 1, { type: 'sell', cardUid: s.players[1].hand[0].uid });
    const v = viewFor(t, 0);
    expect(v.players[1].hasSubmitted).toBe(true);
    expect(JSON.stringify(v)).not.toContain('"pending"');
  });
  it('tower cards and kept cards of others are hidden', () => {
    const json = JSON.stringify(viewFor({ ...s, kept: [null, { uid: 'secret#1', defId: 'x' }, null] }, 0));
    expect(json).not.toContain('secret#1');
  });
});
