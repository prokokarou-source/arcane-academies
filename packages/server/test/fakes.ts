import type { Action } from '@arcane/engine';
import type { CloseReason, ErrorCode, ServerMessage } from '@arcane/protocol';
import { ManualClock } from '../src/clock';
import { Room, type Conn, type RoomOptions } from '../src/room';

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** A connection that records everything the room sends to it. */
export class FakeConn implements Conn {
  sent: ServerMessage[] = [];
  closedWith: CloseReason | null = null;
  constructor(
    public label = '',
    private onSend?: (m: ServerMessage, conn: FakeConn) => void,
  ) {}
  send(m: ServerMessage): void {
    this.sent.push(m);
    this.onSend?.(m, this);
  }
  close(reason: CloseReason): void {
    this.closedWith = reason;
  }
  last<T extends ServerMessage['t']>(t: T): Msg<T> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i] as Msg<T>;
    return undefined;
  }
  lastError(): ErrorCode | undefined {
    return this.last('error')?.code;
  }
}

export function makeRoom(opts: Partial<RoomOptions> = {}) {
  const clock = new ManualClock(1_000_000);
  const room = new Room('WAND-42', { clientUrl: 'http://client', seed: () => 7, ...opts }, clock);
  return { room, clock };
}

/** Open a room with `names.length` humans (first is host). */
export function lobbyWith(names: string[], opts: Partial<RoomOptions> = {}, onSend?: (m: ServerMessage, c: FakeConn) => void) {
  const { room, clock } = makeRoom(opts);
  const conns = names.map((n) => new FakeConn(n, onSend));
  conns.forEach((c, i) => room.join(c, names[i]));
  return { room, clock, conns };
}

export const firstLegal = (legal: Action[]) => legal[0];

/** Let every conn act whenever it is offered legal actions, until the game ends. */
export function playToEnd(room: Room, conns: FakeConn[], pick: (legal: Action[], c: FakeConn) => Action = firstLegal) {
  for (let i = 0; i < 5000; i++) {
    if (conns.some((c) => c.last('game')?.result)) return;
    const c = conns.find((x) => (x.last('game')?.legal.length ?? 0) > 0);
    if (!c) throw new Error('stuck: nobody can act and the game has not ended');
    room.handle(c, { t: 'act', action: pick(c.last('game')!.legal, c) });
  }
  throw new Error('game did not end');
}
