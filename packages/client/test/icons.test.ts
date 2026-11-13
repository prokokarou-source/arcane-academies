import { describe, expect, it } from 'vitest';
import { DISCIPLINE_ICON, RESOURCE_ICON } from '../src/ui/icons';

// Alchemical Symbols (U+1F700–U+1F77F) have no glyph in most phone fonts and render as boxes or look-alikes.
const ALCHEMICAL = /[\u{1F700}-\u{1F77F}]/u;

describe('icons', () => {
  it('uses only glyphs that phone fonts can show', () => {
    for (const icon of [...Object.values(DISCIPLINE_ICON), ...Object.values(RESOURCE_ICON)]) {
      expect(icon).not.toMatch(ALCHEMICAL);
    }
  });

  it('gives each discipline a different icon', () => {
    expect(new Set(Object.values(DISCIPLINE_ICON)).size).toBe(3);
  });
});
