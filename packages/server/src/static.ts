/** Serves the built web client from one folder, so the game and its server share one address. */
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Returns a handler that answers GET/HEAD for files in `dir`; unknown non-asset paths get index.html. */
export function staticHandler(dir: string) {
  const root = resolve(dir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = resolve(root, '.' + normalize('/' + path));
    const inside = file === root || file.startsWith(root + sep);
    const target = inside ? await existingFile(file) : null;
    // Paths with a file extension are assets: missing ones are a real 404, not the app.
    const fallback = !target && !extname(path) ? join(root, 'index.html') : null;
    const chosen = target ?? (fallback && (await existingFile(fallback)));
    if (!chosen) {
      res.writeHead(404).end();
      return;
    }
    const body = await readFile(chosen);
    const hashed = chosen.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': TYPES[extname(chosen).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

async function existingFile(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) return existingFile(join(p, 'index.html'));
  } catch {
    // not found
  }
  return null;
}
