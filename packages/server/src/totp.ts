/**
 * Time-based one-time passwords (RFC 6238, built on HOTP RFC 4226) for the admin second factor.
 * The same 6-digit, 30-second, SHA-1 codes that Google Authenticator and Microsoft Authenticator show.
 * Small and standard, checked against the RFC test vectors in test/totp.test.ts.
 */
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;

/** RFC 4648 base32 without padding (what authenticator apps expect in an otpauth URI). */
export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes base32, ignoring case, spaces and padding; throws on other characters. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP with dynamic truncation. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const off = mac[mac.length - 1] & 0xf;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** The time step a moment (epoch ms) falls in. */
export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_S);

export function totp(key: Uint8Array, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(key, totpStep(nowMs), digits);
}

/**
 * The time step a 6-digit code matches, allowing one step of clock drift either way, or null.
 * Steps at or before `lastStep` are refused, so a code cannot be used twice.
 */
export function verifyTotp(key: Uint8Array, code: string, nowMs: number, lastStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    if (safeEqual(hotp(key, step), code)) return step;
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** A fresh 160-bit secret (the RFC's recommended size for SHA-1). */
export const newTotpSecret = () => randomBytes(20);

/** What the QR code holds: the app adds an entry "Arcane Academies (username)". */
export function otpauthUri(secret: Uint8Array, account: string, issuer = 'Arcane Academies'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_S) });
  return `otpauth://totp/${label}?${q.toString().replace(/\+/g, '%20')}`;
}
