import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totp, verifyTotp } from '../src/totp';

const RFC_KEY = Buffer.from('12345678901234567890');

describe('base32', () => {
  it('matches RFC 4648 vectors (without padding)', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, enc] of cases) {
      expect(base32Encode(Buffer.from(plain))).toBe(enc);
      expect(base32Decode(enc).toString()).toBe(plain);
    }
  });

  it('round-trips a 20-byte secret and ignores case, spaces and padding', () => {
    const key = Buffer.from(Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255));
    expect(base32Decode(base32Encode(key)).equals(key)).toBe(true);
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZ1')).toThrow();
  });
});

describe('HOTP / TOTP', () => {
  it('matches the RFC 4226 HOTP vectors', () => {
    const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    want.forEach((code, counter) => expect(hotp(RFC_KEY, counter)).toBe(code));
  });

  it('matches the RFC 6238 SHA-1 vectors (8 digits)', () => {
    const cases: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, code] of cases) expect(totp(RFC_KEY, t * 1000, 8)).toBe(code);
  });

  it('accepts the current code and one step of drift, and refuses reuse', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_KEY, now);
    const step = verifyTotp(RFC_KEY, code, now);
    expect(step).toBe(Math.floor(now / 30_000));
    expect(verifyTotp(RFC_KEY, code, now + 30_000)).toBe(step); // phone clock a step behind
    expect(verifyTotp(RFC_KEY, code, now + 90_000)).toBeNull(); // too old
    expect(verifyTotp(RFC_KEY, code, now, step!)).toBeNull(); // already used
    expect(verifyTotp(RFC_KEY, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_KEY, 'abcdef', now)).toBeNull();
  });

  it('builds an otpauth URI the apps understand', () => {
    const uri = otpauthUri(Buffer.from('foobar'), 'prok');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Arcane%20Academies%3Aprok\?/);
    expect(uri).not.toContain('+');
    const q = new URL(uri).searchParams;
    expect(q.get('secret')).toBe('MZXW6YTBOI');
    expect(q.get('issuer')).toBe('Arcane Academies');
    expect(q.get('digits')).toBe('6');
    expect(q.get('period')).toBe('30');
  });
});
