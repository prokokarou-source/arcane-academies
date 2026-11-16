import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { encode, isSocialMessage, MAX_MESSAGE_BYTES, parseClientMessage, type CloseReason } from '@arcane/protocol';
import { realClock } from './clock';
import { RoomManager, type ManagerOptions } from './manager';
import type { Conn } from './room';
import { Social } from './social';
import { staticHandler } from './static';
import { MemoryStore, type Store } from './store';

export interface ServerOptions {
  port: number;
  host?: string;
  manager?: Partial<ManagerOptions>;
  /** Ping interval used to detect dead sockets (phones that vanished without closing). */
  heartbeatMs?: number;
  /** Folder with the built web client (packages/client/dist). When set, the server also serves the game page. */
  staticDir?: string;
  /** Accounts and friends; in memory when not given. Closed together with the server. */
  store?: Store;
}

export interface RunningServer {
  port: number;
  manager: RoomManager;
  social: Social;
  close(): Promise<void>;
}

/** WebSocket close codes the client can react to. */
export const CLOSE_CODES: Partial<Record<CloseReason, number>> = { replaced: 4001, expired: 4002 };

function wrap(ws: WebSocket): Conn {
  return {
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(encode(msg));
    },
    close(reason) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(encode({ t: 'closed', reason }));
      // 'left' and 'removed' keep the socket so the client can create or join another room.
      const code = CLOSE_CODES[reason];
      if (code) ws.close(code, reason);
    },
  };
}

/** Start the HTTP + WebSocket server. `port: 0` picks a free port. */
export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const store = opts.store ?? new MemoryStore();
  // Rooms ask Social who is logged in on a connection and hand it finished games to record.
  const manager: RoomManager = new RoomManager(
    { ...opts.manager, accountOf: (c) => social.userOf(c)?.id ?? null, onResults: (r) => social.recordResults(r) },
    realClock,
  );
  const social: Social = new Social(store, { roomOf: (c) => manager.codeOf(c), clock: realClock });
  const serveStatic = opts.staticDir ? staticHandler(opts.staticDir) : null;
  const http = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: manager.size() }));
      return;
    }
    if (serveStatic && (req.method === 'GET' || req.method === 'HEAD')) {
      serveStatic(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    const conn = wrap(ws);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      try {
        const msg = isBinary ? null : parseClientMessage(data.toString());
        if (!msg) return conn.send({ t: 'error', code: 'bad_message', message: 'Malformed message' });
        if (isSocialMessage(msg)) void social.handle(conn, msg);
        else manager.onMessage(conn, msg);
      } catch (e) {
        console.error('message handler failed', e);
        conn.send({ t: 'error', code: 'bad_message', message: 'Server error' });
      }
    });
    ws.on('close', () => {
      try {
        social.onClose(conn);
        manager.onClose(conn);
      } catch (e) {
        console.error('close handler failed', e);
      }
    });
    ws.on('error', () => ws.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 30_000);
  heartbeat.unref();

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        manager,
        social,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            manager.stop();
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => http.close(() => void store.close().then(done, done)));
          }),
      });
    });
  });
}
