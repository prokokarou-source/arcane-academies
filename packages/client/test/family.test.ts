import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/strings';
import { FAMILIES, FAMILY_COLOR } from '../src/ui/Family';

describe('card families', () => {
  it('gives every family its own colour', () => {
    expect(new Set(FAMILIES.map((f) => FAMILY_COLOR[f].toLowerCase())).size).toBe(FAMILIES.length);
  });

  it('gives every family a short label', () => {
    for (const f of FAMILIES) expect(en[`fam_${f}`]).toBeTruthy();
  });
});
