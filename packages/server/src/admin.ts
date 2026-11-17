/**
 * The admin API behind the hidden /admin page. Three locks, all checked on the server for every request:
 *  1. a normal login (Bearer token) of an account whose `is_admin` flag was set by hand in the database;
 *  2. a 6-digit code from an authenticator app (TOTP) or a one-time backup code;
 *  3. the admin session that code opened, which ends after 30 minutes without use.
 * Anyone else gets 404, so the API does not even admit it exists. 5 wrong codes lock it for 15 minutes.
 */
import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { RECOVERY_ALPHABET } from '@arcane/protocol';
import { bearer, BodyError, isObject, readJson, sendJson } from './http';
import { loadNumbers, type AdminFactor, type Insights, type LiveNumbers } from './insights';
import { hashPassword, hashToken, newToken, verifyPassword } from './passwords';
import { open, seal, type BoxKey } from './secretBox';
import type { Store, User } from './store';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp';

export const ADMIN_PREFIX = '/api/admin/';
export const ADMIN_IDLE_MS = 30 * 60_000;
export const ADMIN_LOCK_MS = 15 * 60_000;
export const ADMIN_MAX_FAILURES = 5;
export const BACKUP_CODES = 8;
const FEEDBACK_LIMIT = 300;

export interface AdminOptions {
  store: Store;
  insights: Insights;
  /** From ADMIN_KEY; without it the admin API is off (404 for everyone). */
  key: BoxKey | null;
  live(): LiveNumbers;
  now?: () => number;
}

/** A backup code like `K7QM2-XH9TD` (~50 bits); only its scrypt hash is stored. */
export function newBackupCode(): string {
  const part = () => Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}
const normalizeBackup = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}
const notFound = () => new Reply(404);

export class AdminApi {
  private readonly now: () => number;
  /** Admin sessions by token hash; kept in memory, so a server restart asks for a new code. */
  private sessions = new Map<string, { userId: string; lastSeen: number }>();
  /** One code check at a time per account, so parallel guesses cannot slip past the lockout. */
  private checking = new Set<string>();

  constructor(private readonly opts: AdminOptions) {
    this.now = opts.now ?? Date.now;
  }

  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith(ADMIN_PREFIX)) return false;
    this.route(req, path.slice(ADMIN_PREFIX.length))
      .then((r) => sendJson(res, r.status, r.body))
      .catch((e: unknown) => {
        if (e instanceof Reply) return sendJson(res, e.status, e.body);
        if (e instanceof BodyError) return sendJson(res, e.status);
        console.error('admin request failed:', (e as Error).message);
        sendJson(res, 503);
      });
    return true;
  }

  /** The logged-in admin account, or a 404 for anyone else. */
  private async admin(req: IncomingMessage): Promise<User> {
    const token = bearer(req);
    if (!this.opts.key || !token) throw notFound();
    const user = await this.opts.store.sessionUser(hashToken(token));
    if (!user || !(await this.opts.insights.isAdmin(user.id))) throw notFound();
    return user;
  }

  private async route(req: IncomingMessage, sub: string): Promise<Reply> {
    let user: User;
    try {
      user = await this.admin(req);
    } catch (e) {
      req.resume();
      throw e;
    }
    const post = req.method === 'POST';
    if (!post) req.resume();
    if (post && sub === 'status') return this.status(user);
    if (post && sub === 'setup') return this.setup(user);
    if (post && (sub === 'confirm' || sub === 'login')) return this.checkCode(user, sub, await readJson(req, 1024));
    // Everything else needs the admin session too.
    const session = this.session(req, user);
    if (post && sub === 'logout') {
      this.sessions.delete(session);
      return new Reply(204);
    }
    if (!post && sub === 'numbers') return new Reply(200, await loadNumbers(this.opts.insights, this.now(), this.opts.live()));
    if (!post && sub === 'feedback') return new Reply(200, { items: await this.opts.insights.feedback(FEEDBACK_LIMIT) });
    const shot = /^feedback\/(\d{1,18})\/screenshot$/.exec(sub);
    if (!post && shot) return new Reply(200, { screenshot: await this.opts.insights.screenshot(shot[1]) });
    const read = /^feedback\/(\d{1,18})\/read$/.exec(sub);
    if (post && read) {
      const body = await readJson(req, 256);
      if (!isObject(body) || typeof body.read !== 'boolean') return new Reply(400);
      await this.opts.insights.setFeedbackRead(read[1], body.read);
      return new Reply(204);
    }
    return notFound();
  }

  /** Checks the admin session header; touches it, or throws 401 when missing or idle too long. */
  private session(req: IncomingMessage, user: User): string {
    const raw = req.headers['x-admin-session'];
    const hash = typeof raw === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(raw) ? hashToken(raw) : null;
    const s = hash ? this.sessions.get(hash) : undefined;
    const now = this.now();
    if (!hash || !s || s.userId !== user.id || now - s.lastSeen > ADMIN_IDLE_MS) {
      if (hash && s && now - s.lastSeen > ADMIN_IDLE_MS) this.sessions.delete(hash);
      throw new Reply(401, { error: 'session' });
    }
    s.lastSeen = now;
    return hash;
  }

  private openSession(userId: string): string {
    const now = this.now();
    for (const [h, s] of this.sessions) if (s.userId === userId || now - s.lastSeen > ADMIN_IDLE_MS) this.sessions.delete(h);
    const token = newToken();
    this.sessions.set(hashToken(token), { userId, lastSeen: now });
    return token;
  }

  private locked(f: AdminFactor | null): Reply | null {
    return f && f.lockedUntil > this.now() ? new Reply(429, { error: 'locked', until: f.lockedUntil }) : null;
  }

  private async status(user: User): Promise<Reply> {
    const f = await this.opts.insights.adminFactor(user.id);
    return this.locked(f) ?? new Reply(200, { stage: f?.confirmed ? 'code' : 'setup', username: user.username });
  }

  /** The QR code, shown once: only while no authenticator has been confirmed yet. */
  private async setup(user: User): Promise<Reply> {
    const old = await this.opts.insights.adminFactor(user.id);
    if (old?.confirmed) return new Reply(409, { error: 'already_set_up' });
    const lock = this.locked(old);
    if (lock) return lock;
    const secret = newTotpSecret();
    await this.opts.insights.saveAdminFactor(user.id, {
      secretBox: seal(this.opts.key!, secret),
      confirmed: false,
      backupHashes: [],
      lastStep: -1,
      failures: old?.failures ?? 0,
      lockedUntil: 0,
    });
    const uri = otpauthUri(secret, user.username);
    const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return new Reply(200, { qr, secret: base32Encode(secret).replace(/(.{4})/g, '$1 ').trim() });
  }

  /** `confirm`: the first code after the QR scan (returns the backup codes once). `login`: a code or a backup code. */
  private async checkCode(user: User, mode: 'confirm' | 'login', body: unknown): Promise<Reply> {
    const code = isObject(body) && typeof body.code === 'string' && body.code.length <= 32 ? body.code.replace(/\s/g, '') : null;
    if (!code) return new Reply(400);
    if (this.checking.has(user.id)) return new Reply(429, { error: 'busy' });
    this.checking.add(user.id);
    try {
      const f = await this.opts.insights.adminFactor(user.id);
      if (!f || f.confirmed !== (mode === 'login')) return new Reply(409, { error: mode === 'login' ? 'not_set_up' : 'already_set_up' });
      const lock = this.locked(f);
      if (lock) return lock;
      const secret = open(this.opts.key!, f.secretBox);
      if (!secret) {
        console.error('admin: the stored authenticator secret cannot be opened (was ADMIN_KEY changed?)');
        return new Reply(503, { error: 'key' });
      }
      const step = verifyTotp(secret, code, this.now(), f.lastStep);
      let backupLeft = f.backupHashes;
      let ok = step !== null;
      if (!ok && mode === 'login' && /^[A-Z0-9]{10}$/.test(normalizeBackup(code))) {
        for (const h of f.backupHashes) {
          if (await verifyPassword(normalizeBackup(code), h)) {
            ok = true;
            backupLeft = f.backupHashes.filter((x) => x !== h);
            break;
          }
        }
      }
      if (!ok) {
        const failures = f.failures + 1;
        const lockNow = failures >= ADMIN_MAX_FAILURES;
        await this.opts.insights.saveAdminFactor(user.id, {
          ...f,
          failures: lockNow ? 0 : failures,
          lockedUntil: lockNow ? this.now() + ADMIN_LOCK_MS : f.lockedUntil,
        });
        if (lockNow) return new Reply(429, { error: 'locked', until: this.now() + ADMIN_LOCK_MS });
        return new Reply(401, { error: 'wrong_code', left: ADMIN_MAX_FAILURES - failures });
      }
      let backupCodes: string[] | undefined;
      if (mode === 'confirm') {
        backupCodes = Array.from({ length: BACKUP_CODES }, newBackupCode);
        backupLeft = await Promise.all(backupCodes.map((c) => hashPassword(normalizeBackup(c))));
      }
      await this.opts.insights.saveAdminFactor(user.id, {
        ...f,
        confirmed: true,
        backupHashes: backupLeft,
        lastStep: step ?? f.lastStep,
        failures: 0,
        lockedUntil: 0,
      });
      return new Reply(200, { session: this.openSession(user.id), backupLeft: backupLeft.length, ...(backupCodes ? { backupCodes } : {}) });
    } finally {
      this.checking.delete(user.id);
    }
  }
}
