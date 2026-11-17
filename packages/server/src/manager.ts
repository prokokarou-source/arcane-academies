import type { ClientMessage, OpenRoom, Queue, QueueKind } from '@arcane/protocol';
import type { Clock } from './clock';
import { generateCode, normalizeCode } from './codes';
import { checkConfig, Room, type Conn, type RoomOptions, type RoomSetup } from './room';

export interface ManagerOptions extends RoomOptions {
  /** A room with no client message for this long is closed. */
  idleMs: number;
  /** How often idle and closed rooms are swept. */
  sweepMs: number;
  /** Queues: the lobby countdown before a matched game starts by itself. */
  quickStartMs: number;
  /** Queues 3-5 and 6-7: after this long, start with fewer players than a full table (at least the minimum). */
  queueFillMs: Record<Exclude<Queue, '1v1'>, number>;
  /** Public room list: at most one update per this many ms. */
  roomsThrottleMs: number;
  /** Queues: true when the accounts on these two connections must not play together (one blocked the other). */
  apart?(a: Conn, b: Conn): boolean;
}

/** How many humans each queue seats: a full table starts at once, `min` after the queue's fill time. */
const QUEUE_SIZES: Record<Queue, { min: number; max: number }> = {
  '1v1': { min: 2, max: 2 },
  '3-5': { min: 3, max: 5 },
  '6-7': { min: 6, max: 7 },
};

/** A player waiting in a Casual or Ranked queue. */
interface Waiting {
  conn: Conn;
  name: string;
  kind: QueueKind;
  queue: Queue;
  since: number;
  account: string | null;
}

export const DEFAULT_MANAGER_OPTIONS: ManagerOptions = {
  clientUrl: 'http://localhost:5173',
  idleMs: 30 * 60_000,
  sweepMs: 60_000,
  quickStartMs: 10_000,
  queueFillMs: { '3-5': 45_000, '6-7': 60_000 },
  roomsThrottleMs: 1_000,
};

const ENTERS_ROOM: readonly ClientMessage['t'][] = ['create', 'createRoom', 'join', 'joinRoom', 'rejoin'];

/** Owns every room: creates them, runs the queues and the public room list, routes client messages, expires idle rooms. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private connRoom = new Map<Conn, Room>();
  private readonly opts: ManagerOptions;
  private sweepTimer: unknown = null;
  private waiting: Waiting[] = [];
  private queueTimer: unknown = null;
  /** Connections on the Rooms tab, and what they were last sent. */
  private watchers = new Set<Conn>();
  private roomsSent = '[]';
  private roomsSentAt = -Infinity;
  private roomsTimer: unknown = null;

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

  /** How many players wait in all queues. */
  searching(): number {
    return this.waiting.length;
  }

  /** Public rooms in their lobby with a free seat, oldest first. */
  openRooms(): OpenRoom[] {
    return [...this.rooms.values()].map((r) => r.openInfo()).filter((r): r is OpenRoom => r !== null);
  }

  onMessage(conn: Conn, msg: ClientMessage): void {
    // Creating or joining a room ends a queue search.
    if (ENTERS_ROOM.includes(msg.t)) this.dequeue(conn);
    switch (msg.t) {
      case 'queueJoin': {
        const account = this.opts.accountOf?.(conn) ?? null;
        if (msg.kind === 'ranked' && !account) return conn.send({ t: 'error', code: 'not_logged_in', message: 'Log in to play ranked' });
        this.detach(conn);
        this.waiting = this.waiting.filter((w) => w.conn !== conn);
        this.waiting.push({ conn, name: msg.name, kind: msg.kind, queue: msg.queue, since: this.clock.now(), account });
        return this.queueChanged();
      }
      case 'queueLeave':
        if (this.dequeue(conn)) conn.send({ t: 'queueLeft' });
        return;
      case 'roomsWatch':
        this.watchers.add(conn);
        return conn.send({ t: 'rooms', rooms: this.openRooms() });
      case 'roomsUnwatch':
        this.watchers.delete(conn);
        return;
      case 'createRoom': {
        const why = checkConfig(msg.settings, 1);
        if (why) return conn.send({ t: 'error', code: 'bad_settings', message: why });
        this.detach(conn);
        const room = this.open({ kind: 'room', config: msg.settings });
        return this.enter(conn, room, () => room.join(conn, msg.name));
      }
      case 'create': {
        // Older clients: a private room with the server's defaults.
        this.detach(conn);
        const room = this.open({ kind: 'room' });
        return this.enter(conn, room, () => room.join(conn, msg.name));
      }
      case 'join':
      case 'joinRoom':
      case 'rejoin': {
        const room = this.room(msg.code);
        if (!room || room.closed) return conn.send({ t: 'error', code: 'no_room', message: 'No room with that code' });
        if (this.connRoom.get(conn) !== room) this.detach(conn);
        return this.enter(conn, room, () => (msg.t === 'rejoin' ? room.rejoin(conn, msg.token) : room.join(conn, msg.name)));
      }
      default: {
        const room = this.connRoom.get(conn);
        if (!room) return conn.send({ t: 'error', code: 'not_in_room', message: 'You are not in a room' });
        room.handle(conn, msg);
      }
    }
  }

  /** The account on this connection changed its avatar: its room shows the new one. */
  refreshAvatar(conn: Conn): void {
    const room = this.connRoom.get(conn);
    if (room && !room.closed) room.refreshAvatar(conn);
  }

  /** The transport lost this connection. */
  onClose(conn: Conn): void {
    this.watchers.delete(conn);
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
    for (const t of [this.sweepTimer, this.queueTimer, this.roomsTimer]) if (t !== null) this.clock.clearTimer(t);
    this.sweepTimer = this.queueTimer = this.roomsTimer = null;
    this.waiting = [];
    this.watchers.clear();
    for (const room of this.rooms.values()) room.close('expired');
    this.rooms.clear();
    this.connRoom.clear();
  }

  // ---------- rooms ----------

  private open(setup: Omit<RoomSetup, 'onChange'>): Room {
    const code = generateCode((c) => this.rooms.has(c));
    const room = new Room(code, this.opts, this.clock, { ...setup, onChange: () => this.roomsChanged() });
    this.rooms.set(code, room);
    return room;
  }

  /** Something a listed room shows may have changed: send the list to watchers, at most once per throttle period. */
  private roomsChanged(): void {
    if (this.watchers.size === 0 || this.roomsTimer !== null) return;
    const wait = this.roomsSentAt + this.opts.roomsThrottleMs - this.clock.now();
    if (wait <= 0) return this.sendRooms();
    this.roomsTimer = this.clock.setTimer(wait, () => {
      this.roomsTimer = null;
      this.sendRooms();
    });
  }

  private sendRooms(): void {
    const rooms = this.openRooms();
    const json = JSON.stringify(rooms);
    if (json === this.roomsSent) return;
    this.roomsSent = json;
    this.roomsSentAt = this.clock.now();
    for (const w of this.watchers) w.send({ t: 'rooms', rooms });
  }

  // ---------- queues ----------

  /** Take this conn out of its queue. True if it was waiting. */
  private dequeue(conn: Conn): boolean {
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((w) => w.conn !== conn);
    if (this.waiting.length === before) return false;
    this.queueChanged();
    return true;
  }

  private pool(kind: QueueKind, queue: Queue): Waiting[] {
    return this.waiting.filter((w) => w.kind === kind && w.queue === queue);
  }

  private fillMs(queue: Queue): number | null {
    return queue === '1v1' ? null : this.opts.queueFillMs[queue];
  }

  /** Match whoever can be matched, tell the rest how the search goes, and wake up for the next fill time. */
  private queueChanged(): void {
    const now = this.clock.now();
    const pools = new Map<string, Waiting[]>();
    for (const w of this.waiting) pools.set(`${w.kind}:${w.queue}`, this.pool(w.kind, w.queue));
    for (const pool of pools.values()) this.match(pool);
    let next = Infinity;
    for (const w of this.waiting) {
      const pool = this.pool(w.kind, w.queue);
      w.conn.send({ t: 'queueState', kind: w.kind, queue: w.queue, searching: pool.length, waitedMs: now - w.since });
      const fill = this.fillMs(w.queue);
      if (fill !== null && pool.length >= QUEUE_SIZES[w.queue].min && w.since + fill > now) next = Math.min(next, w.since + fill);
    }
    if (this.queueTimer !== null) this.clock.clearTimer(this.queueTimer);
    this.queueTimer = null;
    if (Number.isFinite(next)) {
      this.queueTimer = this.clock.setTimer(next - now, () => {
        this.queueTimer = null;
        this.queueChanged();
      });
    }
  }

  /** Full tables at once; after the fill time, the oldest player starts with whoever there is (at least the minimum). */
  private match(pool: Waiting[]): void {
    const { min, max } = QUEUE_SIZES[pool[0].queue];
    const fill = this.fillMs(pool[0].queue);
    let rest = pool;
    while (rest.length >= min) {
      const group = this.pick(rest, max);
      const overdue = fill !== null && this.clock.now() - rest[0].since >= fill;
      if (group.length < max && !(overdue && group.length >= min)) return;
      this.seat(group);
      rest = rest.filter((w) => !group.includes(w));
    }
  }

  /** Up to `n` players in queue order, skipping anyone kept apart from (or the same account as) a player already picked. */
  private pick(candidates: Waiting[], n: number): Waiting[] {
    const group: Waiting[] = [];
    for (const w of candidates) {
      if (group.length >= n) break;
      const clash = group.some((g) => (g.account !== null && g.account === w.account) || this.opts.apart?.(g.conn, w.conn));
      if (!clash) group.push(w);
    }
    return group;
  }

  /** Open a queue room for these players; its lobby counts down and then starts with exactly them. */
  private seat(group: Waiting[]): void {
    this.waiting = this.waiting.filter((w) => !group.includes(w));
    const room = this.open({ kind: group[0].kind, queue: group[0].queue });
    for (const w of group) this.enter(w.conn, room, () => room.join(w.conn, w.name));
    room.startCountdown(this.opts.quickStartMs);
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
