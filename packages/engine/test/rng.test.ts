import { describe, it, expect } from 'vitest';
import { shuffle } from '../src/rng';

const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('rng', () => {
  it('shuffle is deterministic', () => {
    expect(shuffle(ten, 42)).toEqual(shuffle(ten, 42));
  });
  it('shuffle is a permutation', () => {
    const [out] = shuffle(ten, 42);
    expect([...out].sort((a, b) => a - b)).toEqual(ten);
  });
  it('different seeds differ', () => {
    expect(shuffle(ten, 1)[0]).not.toEqual(shuffle(ten, 2)[0]);
  });
});
