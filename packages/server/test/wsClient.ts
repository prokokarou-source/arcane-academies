import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@arcane/protocol';

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;
type GameMsg = Msg<'game'>;

/** A real WebSocket client for tests: records raw frames and lets tests await messages. */
export class TestClient {
  raw: string[] = [];
  messages: ServerMessage[] = [];
  closed = false;
  closeCode: number | null = null;
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      this.messages.push(JSON.parse(text) as ServerMessage);
      this.wake();
    });
    ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
      this.wake();
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', reject);
    });
  }

  send(msg: ClientMessage | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }

  /** Resolve once some message (newest first, down to index `from`) matches. */
  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, from = 0, timeoutMs = 5000): Promise<Msg<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = this.messages.length - 1; i >= from; i--) {
        const m = this.messages[i];
        if (m.t === t && pred(m as Msg<T>)) return m as Msg<T>;
      }
      if (this.closed) throw new Error(`socket closed while waiting for ${t}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${t}`);
      await new Promise<void>((r) => {
        const timer = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          r();
        });
      });
    }
  }

  /** The newest game message, if any. */
  latestGame(): GameMsg | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].t === 'game') return this.messages[i] as GameMsg;
    return undefined;
  }

  /** Act with legal[0] whenever offered, until the game ends. Returns the final game message. */
  async playToEnd(): Promise<GameMsg> {
    let acted = '';
    for (;;) {
      await this.waitFor('game', () => {
        const g = this.latestGame()!;
        return !!g.result || (g.legal.length > 0 && keyOf(g) !== acted);
      });
      const g = this.latestGame()!;
      if (g.result) return g;
      acted = keyOf(g);
      this.send({ t: 'act', action: g.legal[0] });
    }
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
}

export const keyOf = (g: GameMsg) => `${g.view.term}/${g.view.turn}/${g.view.phase}`;
