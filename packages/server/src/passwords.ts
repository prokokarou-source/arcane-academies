import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scryptAsync = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

/** scrypt cost; ~16 MB and tens of ms per hash, which runs on the libuv pool, not the event loop. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** Stored as `scrypt$N$r$p$salt$hash` (base64), so the cost can change later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

/** A fresh login token for the client to keep. */
export const newToken = () => randomBytes(32).toString('base64url');

/** What the store keeps instead of the token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
