import type { ClientMessage, QuickSize } from '@arcane/protocol';
import type { Clock } from './clock';
import { generateCode, normalizeCode } from './codes';
import { Room, type Conn, type RoomOptions } from './room';

export interface ManagerOptions extends RoomOptions {
  /** A room with no client message for this long is closed. */
  idleMs: number;
  /** How often idle and closed rooms are swept. */
  sweepMs: number;
  /** Quick match: the lobby countdown before a matched game starts by itself. */
  quickStartMs: number;
  /** Quick match: after this long, start with whoever compatible is waiting and fill the rest with bots. */
  quickFillMs: number;
}

/** A player in the quick-match queue. */
interface Waiting {
  conn: Conn;
  name: string;
  size: QuickSize;
  since: number;
}

const ANY_SIZE = 4;
const fits = (w: Waiting, n: number) => w.size === null || w.size === n;

export const DEFAULT_MANAGER_OPTIONS: ManagerOptions = {
  clientUrl: 'http://localhost:5173',
  idleMs: 30 * 60_000,
  sweepMs: 60_000,
  quickStartMs: 10_000,
  quickFillMs: 45_000,
};

/** Owns every room: creates them, routes client messages, expires idle ones. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private connRoom = new Map<Conn, Room>();
  private readonly opts: ManagerOptions;
  private sweepTimer: unknown = null;
  private waiting: Waiting[] = [];
  private queueTimer: unknown = null;

  constructor(
    opts: Partial<ManagerOptions>,
    private readonly clock: Clock,
  ) {
    this.opts = { ...DEFAULT_MANAGER_OPTIONS, ...opts };
    this.scheduleSweep();
  }

  room(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  /** The code of the open room this connection is seated in, if any. */
  codeOf(conn: Conn): string | null {
    const room = this.connRoom.get(conn);
    return room && !room.closed && room.hasMember(conn) ? room.code : null;
  }

  size(): number {
    return this.rooms.size;
  }

  /** How many players are in the quick-match queue. */
  searching(): number {
    return this.waiting.length;
  }

  onMessage(conn: Conn, msg: ClientMessage): void {
    // Creating or joining a room ends a quick-match search.
    if (msg.t === 'create' || msg.t === 'join' || msg.t === 'rejoin') this.dequeue(conn);
    switch (msg.t) {
      case 'quickMatch':
        this.detach(conn);
        this.waiting = this.waiting.filter((w) => w.conn !== conn);
        this.waiting.push({ conn, name: msg.name, size: msg.size, since: this.clock.now() });
        return this.queueChanged();
      case 'quickCancel':
        if (this.dequeue(conn)) conn.send({ t: 'quickCancelled' });
        return;
      case 'quickBots': {
        const w = this.waiting.find((x) => x.conn === conn);
        if (!w) return conn.send({ t: 'error', code: 'wrong_phase', message: 'You are not searching' });
        this.waiting = this.waiting.filter((x) => x !== w);
        this.seat([w], w.size ?? ANY_SIZE);
        return this.queueChanged();
      }
      case 'create': {
        this.detach(conn);
        const code = generateCode((c) => this.rooms.has(c));
        const room = new Room(code, this.opts, this.clock);
        this.rooms.set(code, room);
        return this.enter(conn, room, () => room.join(conn, msg.name));
      }
      case 'join':
      case 'rejoin': {
        const room = this.room(msg.code);
        if (!room || room.closed) return conn.send({ t: 'error', code: 'no_room', message: 'No room with that code' });
        if (this.connRoom.get(conn) !== room) this.detach(conn);
        return this.enter(conn, room, () => (msg.t === 'join' ? room.join(conn, msg.name) : room.rejoin(conn, msg.token)));
      }
      default: {
        const room = this.connRoom.get(conn);
        if (!room) return conn.send({ t: 'error', code: 'not_in_room', message: 'You are not in a room' });
        room.handle(conn, msg);
      }
    }
  }

  /** The transport lost this connection. */
  onClose(conn: Conn): void {
    this.dequeue(conn);
    const room = this.connRoom.get(conn);
    this.connRoom.delete(conn);
    room?.disconnect(conn);
  }

  /** Close idle rooms and forget closed ones. */
  sweep(): void {
    const now = this.clock.now();
    for (const [code, room] of this.rooms) {
      if (!room.closed && now - room.lastActivity >= this.opts.idleMs) room.close('expired');
      if (room.closed) this.rooms.delete(code);
    }
    for (const [conn, room] of this.connRoom) if (room.closed || !room.hasMember(conn)) this.connRoom.delete(conn);
  }

  stop(): void {
    if (this.sweepTimer !== null) this.clock.clearTimer(this.sweepTimer);
    this.sweepTimer = null;
    if (this.queueTimer !== null) this.clock.clearTimer(this.queueTimer);
    this.queueTimer = null;
    this.waiting = [];
    for (const room of this.rooms.values()) room.close('expired');
    this.rooms.clear();
    this.connRoom.clear();
  }

  // ---------- quick match ----------

  /** Take this conn out of the queue. True if it was waiting. */
  private dequeue(conn: Conn): boolean {
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((w) => w.conn !== conn);
    if (this.waiting.length === before) return false;
    this.queueChanged();
    return true;
  }

  /** Match whoever can be matched, tell the rest how the search goes, and wake up for the next timeout. */
  private queueChanged(): void {
    this.matchFull();
    this.matchOverdue();
    const now = this.clock.now();
    for (const w of this.waiting) w.conn.send({ t: 'quickQueue', size: w.size, searching: this.waiting.length, waitedMs: now - w.since });
    if (this.queueTimer !== null) this.clock.clearTimer(this.queueTimer);
    this.queueTimer = null;
    const next = Math.min(...this.waiting.map((w) => w.since + this.opts.quickFillMs).filter((at) => at > now));
    if (Number.isFinite(next)) {
      this.queueTimer = this.clock.setTimer(next - now, () => {
        this.queueTimer = null;
        this.queueChanged();
      });
    }
  }

  /** Full tables first, largest first. Players open to any size wait for a table of 4 (or the timeout). */
  private matchFull(): void {
    for (let found = true; found; ) {
      found = false;
      for (const n of [4, 3, 2]) {
        const exact = this.waiting.filter((w) => w.size === n);
        if (n !== ANY_SIZE && exact.length === 0) continue;
        const group = [...exact, ...this.waiting.filter((w) => w.size === null)].slice(0, n);
        if (group.length < n) continue;
        this.seat(group, n);
        found = true;
        break;
      }
    }
  }

  /** Whoever waited past the timeout starts with the compatible players there are; bots take the empty seats. */
  private matchOverdue(): void {
    const now = this.clock.now();
    for (const old of [...this.waiting]) {
      if (!this.waiting.includes(old) || now - old.since < this.opts.quickFillMs) continue;
      const others = this.waiting.filter((w) => w !== old);
      const sizes = old.size === null ? [4, 3, 2] : [old.size];
      // The size most of the others accept (bigger tables win ties).
      const n = sizes.reduce((best, s) => (others.filter((w) => fits(w, s)).length > others.filter((w) => fits(w, best)).length ? s : best));
      const mates = [...others.filter((w) => w.size === n), ...others.filter((w) => w.size === null)].slice(0, n - 1);
      if (mates.length > 0) this.seat([old, ...mates], n);
    }
  }

  /** Open a quick room for these players; its lobby counts down and then starts with bots in the empty seats. */
  private seat(group: Waiting[], size: number): void {
    this.waiting = this.waiting.filter((w) => !group.includes(w));
    const code = generateCode((c) => this.rooms.has(c));
    const room = new Room(code, this.opts, this.clock);
    this.rooms.set(code, room);
    for (const w of group) this.enter(w.conn, room, () => room.join(w.conn, w.name));
    room.startCountdown(this.opts.quickStartMs, size);
  }

  private enter(conn: Conn, room: Room, fn: () => void): void {
    fn();
    if (room.hasMember(conn)) this.connRoom.set(conn, room);
    else if (this.connRoom.get(conn) === room) this.connRoom.delete(conn);
  }

  private detach(conn: Conn): void {
    const old = this.connRoom.get(conn);
    if (!old) return;
    this.connRoom.delete(conn);
    old.detach(conn);
  }

  private scheduleSweep(): void {
    this.sweepTimer = this.clock.setTimer(this.opts.sweepMs, () => {
      this.sweep();
      this.scheduleSweep();
    });
  }
}
