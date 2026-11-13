import { describe, expect, it } from 'vitest';
import { el, en, translate } from '../src/i18n/strings';

describe('string table', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'waitingFor', { names: 'Ana, Bob' })).toBe('Waiting for Ana, Bob…');
  });

  it('falls back to English for keys missing in Greek', () => {
    const missing = (Object.keys(en) as (keyof typeof en)[]).find((k) => !(k in el))!;
    expect(missing).toBeDefined();
    expect(translate('el', missing)).toBe(translate('en', missing));
  });

  it('leaves unknown placeholders as they are', () => {
    expect(translate('en', 'waitingFor', {})).toBe('Waiting for {names}…');
  });
});
