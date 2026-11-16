import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PgStore } from './pgStore';
import { pushFromEnv } from './push';
import { startServer } from './server';

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

const port = num(process.env.PORT, 8787);
const host = process.env.HOST ?? '0.0.0.0';
// The built web client, served by this same server when present (npm run build).
const builtClient = resolve(process.env.STATIC_DIR ?? 'packages/client/dist');
const staticDir = existsSync(resolve(builtClient, 'index.html')) ? builtClient : undefined;
const graceMs = process.env.GRACE_MS ? num(process.env.GRACE_MS, 60_000) : undefined;

// Accounts live in Postgres when DATABASE_URL is set (e.g. Neon); otherwise in memory until restart.
let store: PgStore | undefined;
if (process.env.DATABASE_URL) {
  store = new PgStore(process.env.DATABASE_URL);
  // A sleeping or unreachable database must not keep the game from starting; init is retried on first use.
  await store.init().catch((e: Error) => console.error('database not ready yet:', e.message));
}

// Web Push for invites and friend requests; off unless all three VAPID_* variables are set.
const push = pushFromEnv(process.env);

const server = await startServer({
  port,
  host,
  ...(store ? { store } : {}),
  push,
  ...(staticDir ? { staticDir } : {}),
  manager: {
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
    idleMs: num(process.env.IDLE_MS, 30 * 60_000),
    ...(graceMs !== undefined ? { defaultSettings: { graceMs } } : {}),
  },
});
console.log(
  `Arcane Academies server listening on :${server.port}${staticDir ? ' (serving the web client)' : ''}; accounts: ${store ? 'database' : 'in memory'}; push: ${push ? 'on' : 'off'}`,
);

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
