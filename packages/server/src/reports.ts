/**
 * Print the newest player reports: `npm run reports [limit]` with DATABASE_URL set.
 * Read-only; there is no admin screen yet.
 */
import { PgStore } from './pgStore';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database to read reports from.');
  process.exit(1);
}
const limit = Math.min(500, Math.max(1, Number(process.argv[2]) || 50));
const store = new PgStore(url);
try {
  const reports = await store.recentReports(limit);
  if (!reports.length) console.log('No reports.');
  for (const r of reports) {
    const room = r.roomCode ? ` room ${r.roomCode}` : '';
    const note = r.note ? ` — ${JSON.stringify(r.note)}` : '';
    console.log(`${new Date(r.at).toISOString()}  ${r.reporter} → ${r.target}  [${r.reason}]${room}${note}`);
  }
} finally {
  await store.close();
}
