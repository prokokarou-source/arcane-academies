/** Small helpers for the JSON HTTP endpoints (feedback, events, admin). */
import type { IncomingMessage, ServerResponse } from 'node:http';

export function clientIp(req: IncomingMessage): string {
  // Render sits behind a proxy; the first forwarded address is the visitor.
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** The token after "Bearer ", or null. */
export function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  const m = typeof h === 'string' ? /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(h) : null;
  return m ? m[1] : null;
}

export function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  if (res.headersSent) return void res.end();
  if (body === undefined) {
    res.writeHead(status, { 'cache-control': 'no-store' });
    return void res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export class BodyError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? 'too large' : 'bad body');
  }
}

/** Reads a JSON body of at most `max` bytes; an empty body is `{}`. */
export function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > max) {
      req.resume();
      return reject(new BodyError(413));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('error', () => reject(new BodyError(400)));
    req.on('end', () => {
      if (size > max) return reject(new BodyError(413));
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new BodyError(400));
      }
    });
  });
}

/** Fixed-window counter per key (IP, account...). */
export class RateLimit {
  private hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly perWindow: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit; false when the key is over its limit. */
  allow(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 5000) for (const [k, h] of this.hits) if (t - h.start >= this.windowMs) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= this.perWindow;
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A string of at most `max` characters (trimmed), or null. */
export function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v.trim() : null;
}
