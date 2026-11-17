/**
 * Encrypts the admin's TOTP secret at rest (AES-256-GCM), so a copy of the database alone cannot
 * produce admin codes. The key comes from the ADMIN_KEY environment variable (any long random string).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type BoxKey = Buffer;

/** A 32-byte key from ADMIN_KEY; null (admin off) when it is missing or too short. */
export function boxKey(secret: string | undefined): BoxKey | null {
  if (!secret || secret.length < 16) return null;
  return createHash('sha256').update(`arcane-admin:${secret}`).digest();
}

/** `v1.iv.tag.data`, base64url parts. */
export function seal(key: BoxKey, plain: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** The secret, or null when the box is damaged or was sealed with another key. */
export function open(key: BoxKey, box: string): Buffer | null {
  const [v, iv, tag, data] = box.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]);
  } catch {
    return null;
  }
}
