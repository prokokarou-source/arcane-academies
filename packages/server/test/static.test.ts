import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function site(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Arcane</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  return dir;
}

async function boot(staticDir?: string) {
  server = await startServer({ port: 0, host: '127.0.0.1', ...(staticDir ? { staticDir } : {}) });
  return `http://127.0.0.1:${server.port}`;
}

describe('serving the web client', () => {
  it('serves index.html, assets with their types, and the health check', async () => {
    const base = await boot(site());
    const home = await fetch(base + '/');
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/html');
    expect(await home.text()).toContain('<title>Arcane</title>');
    const js = await fetch(base + '/assets/app-123.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(base + '/manifest.webmanifest')).headers.get('content-type')).toContain('manifest+json');
    expect(await (await fetch(base + '/health')).json()).toMatchObject({ ok: true });
  });

  it('answers invite links and unknown pages with the app, but missing assets with 404', async () => {
    const base = await boot(site());
    expect(await (await fetch(base + '/?room=WAND-42')).text()).toContain('<title>Arcane</title>');
    expect(await (await fetch(base + '/some/page')).text()).toContain('<title>Arcane</title>');
    expect((await fetch(base + '/assets/missing.js')).status).toBe(404);
  });

  it('never serves files outside the folder', async () => {
    const base = await boot(site());
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json']) {
      const res = await fetch(base + p);
      expect(await res.text()).not.toContain('"name"');
    }
  });

  it('without a client folder the server answers 404 except health', async () => {
    const base = await boot();
    expect((await fetch(base + '/')).status).toBe(404);
    expect((await fetch(base + '/health')).status).toBe(200);
  });
});
