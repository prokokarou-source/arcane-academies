import type { ClientMessage, ServerMessage } from '@arcane/protocol';
import { GameClient, type ClientDeps, type SocketLike } from '../src/net/client';

export class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(public url: string) {}
  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.serverClose(1000);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

export function memoryStorage(): ClientDeps['storage'] & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** A GameClient over fake sockets and manual timers. */
export function harness(storage = memoryStorage()) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  const client = new GameClient({
    url: 'ws://test',
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    storage,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const sock = () => sockets[sockets.length - 1];
  const runTimers = () => timers.splice(0).forEach((t) => t.fn());
  return { client, sockets, sock, timers, runTimers, storage };
}
