import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardProcess, MAX_REPORT_BYTES, parseReport } from '../src/clientErrors';
import { startServer, type RunningServer } from '../src/server';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function boot(perWindow = 3) {
  const lines: string[] = [];
  let time = 1_000;
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    clientErrors: { log: (l) => lines.push(l), now: () => time, perWindow, windowMs: 60_000 },
  });
  const url = `http://127.0.0.1:${server.port}/api/client-error`;
  const post = (body: string, ip = '1.1.1.1') =>
    fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } }).then((r) => r.status);
  return { lines, post, tick: (ms: number) => (time += ms) };
}

const ok = JSON.stringify({ message: 'boom', stack: 'at x\nat y', version: '0.1.0', page: '/' });

describe('POST /api/client-error', () => {
  it('logs one line per valid report and answers 204', async () => {
    const { lines, post } = await boot();
    expect(await post(ok)).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[client-error\] /);
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain('"message":"boom"');
    expect(lines[0]).not.toContain('1.1.1.1');
  });

  it('rejects malformed, oversized and unexpected reports without logging', async () => {
    const { lines, post } = await boot(100);
    expect(await post('not json')).toBe(400);
    expect(await post('[]')).toBe(400);
    expect(await post(JSON.stringify({ message: '' }))).toBe(400);
    expect(await post(JSON.stringify({ message: 1 }))).toBe(400);
    expect(await post(JSON.stringify({ message: 'x', token: 'secret' }))).toBe(400);
    expect(await post(JSON.stringify({ message: 'x'.repeat(501) }))).toBe(400);
    expect(await post(JSON.stringify({ message: 'x', stack: 'y'.repeat(MAX_REPORT_BYTES) }))).toBe(413);
    expect(lines).toEqual([]);
  });

  it('rate-limits per IP and recovers after the window', async () => {
    const { lines, post, tick } = await boot(3);
    for (let i = 0; i < 3; i++) expect(await post(ok)).toBe(204);
    expect(await post(ok)).toBe(429);
    expect(await post(ok, '2.2.2.2')).toBe(204);
    tick(60_000);
    expect(await post(ok)).toBe(204);
    expect(lines).toHaveLength(5);
  });

  it('only answers POST', async () => {
    await boot();
    expect((await fetch(`http://127.0.0.1:${server!.port}/api/client-error`)).status).toBe(404);
  });
});

describe('parseReport', () => {
  it('keeps only the known fields', () => {
    expect(parseReport({ message: 'm', page: '/privacy' })).toEqual({ message: 'm', page: '/privacy' });
    expect(parseReport(null)).toBeNull();
  });
});

describe('guardProcess', () => {
  it('logs uncaught errors and rejections with a clear prefix', () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const log = vi.fn();
    guardProcess({ on: ((ev: string, fn: (e: unknown) => void) => (handlers[ev] = fn)) as never }, log);
    handlers.uncaughtException!(new Error('a'));
    handlers.unhandledRejection!('b');
    expect(log.mock.calls.map((c) => c[0])).toEqual(['[server-uncaught]', '[server-unhandled-rejection]']);
  });
});
