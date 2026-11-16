/**
 * POST /api/client-error: crash reports from the web client, written to the log as one line each.
 * No third-party service: Render's log viewer is the dashboard. Reports carry no personal data,
 * and the sender's IP is used only for rate limiting, never logged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export const CLIENT_ERROR_PATH = '/api/client-error';
export const MAX_REPORT_BYTES = 4096;
const LIMITS = { message: 500, stack: 2000, version: 32, page: 200 } as const;

export interface ClientErrorReport {
  message: string;
  stack?: string;
  version?: string;
  page?: string;
}

export interface ClientErrorOptions {
  now?: () => number;
  log?: (line: string) => void;
  /** Reports allowed per IP per window. */
  perWindow?: number;
  windowMs?: number;
}

/** Accepts only a small object with known string fields; anything else is rejected. */
export function parseReport(body: unknown): ClientErrorReport | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(k in LIMITS))) return null;
  const report: ClientErrorReport = { message: '' };
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > LIMITS[key]) return null;
    report[key] = v;
  }
  return report.message.trim() ? report : null;
}

function clientIp(req: IncomingMessage): string {
  // Render sits behind a proxy; the first forwarded address is the visitor.
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

export function clientErrorHandler(opts: ClientErrorOptions = {}) {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.error(line));
  const perWindow = opts.perWindow ?? 10;
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const hits = new Map<string, { start: number; count: number }>();

  const allow = (ip: string): boolean => {
    const t = now();
    if (hits.size > 5000) for (const [k, h] of hits) if (t - h.start >= windowMs) hits.delete(k);
    const h = hits.get(ip);
    if (!h || t - h.start >= windowMs) {
      hits.set(ip, { start: t, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= perWindow;
  };

  return (req: IncomingMessage, res: ServerResponse): void => {
    const done = (status: number) => {
      if (!res.headersSent) res.writeHead(status, { 'cache-control': 'no-store' });
      res.end();
    };
    if (!allow(clientIp(req))) {
      req.resume();
      return done(429);
    }
    if (Number(req.headers['content-length'] ?? 0) > MAX_REPORT_BYTES) {
      req.resume();
      return done(413);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_REPORT_BYTES) chunks.push(c);
    });
    req.on('error', () => done(400));
    req.on('end', () => {
      if (size > MAX_REPORT_BYTES) return done(413);
      let report: ClientErrorReport | null = null;
      try {
        report = parseReport(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        report = null;
      }
      if (!report) return done(400);
      log(`[client-error] ${JSON.stringify(report)}`);
      done(204);
    });
  };
}

/** Log uncaught server errors with a clear prefix instead of letting one bad callback end the process. */
export function guardProcess(proc: Pick<NodeJS.Process, 'on'> = process, log: (...a: unknown[]) => void = console.error): void {
  proc.on('uncaughtException', (e) => log('[server-uncaught]', e));
  proc.on('unhandledRejection', (e) => log('[server-unhandled-rejection]', e));
}
