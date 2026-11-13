import { startServer } from './server';

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

const port = num(process.env.PORT, 8787);
const host = process.env.HOST ?? '0.0.0.0';
const graceMs = process.env.GRACE_MS ? num(process.env.GRACE_MS, 60_000) : undefined;

const server = await startServer({
  port,
  host,
  manager: {
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
    idleMs: num(process.env.IDLE_MS, 30 * 60_000),
    ...(graceMs !== undefined ? { defaultSettings: { graceMs } } : {}),
  },
});
console.log(`Arcane Academies server listening on :${server.port}`);

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
