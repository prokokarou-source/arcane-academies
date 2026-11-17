import type { ClientMessage, OpenRoom, Queue, QueueKind } from '@arcane/protocol';
import { AI_PROFILES, type AiProfile } from './aiProfiles';
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
  /**
   * Casual/Ranked: when few people are online, empty seats are filled with AI opponents after a random search
   * time in [min, max] ms (null: never). Humans waiting together are always matched first.
   */
  aiFillMs: [number, number] | null;
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
  /** When AI opponents fill the table if no full table of people formed by then. */
  aiAt: number;
}

/** How many recent AI opponents each player is not shown again. */
const AI_RECENT = 40;
/** Players whose recent AI opponents are remembered (oldest forgotten first). */
const AI_RECENT_PLAYERS = 5_000;
/** Ranked AI ratings: the humans' average plus up to this either way. */
export const AI_RATING_SPREAD = 50;

export const DEFAULT_MANAGER_OPTIONS: ManagerOptions = {
  clientUrl: 'http://localhost:5173',
  idleMs: 30 * 60_000,
  sweepMs: 60_000,
  quickStartMs: 10_000,
  queueFillMs: { '3-5': 45_000, '6-7': 60_000 },
  roomsThrottleMs: 1_000,
  aiFillMs: [5_000, 20_000],
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
  /** Recent AI opponents per player (account id, or guest name), newest last. */
  private aiSeen = new Map<string, string[]>();

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

  /** Games in progress with at least one person connected. */
  gamesInProgress(): number {
    return [...this.rooms.values()].filter((r) => r.playingLive()).length;
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
        const now = this.clock.now();
        this.waiting.push({ conn, name: msg.name, kind: msg.kind, queue: msg.queue, since: now, account, aiAt: now + this.aiDelay() });
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
    // Whoever has searched long enough gets a table, with AI opponents in the empty seats.
    for (const key of pools.keys()) {
      const [kind, queue] = key.split(':') as [QueueKind, Queue];
      let pool = this.pool(kind, queue);
      while (this.opts.aiFillMs && pool.length > 0 && pool[0].aiAt <= now) {
        this.fillWithAi(pool);
        pool = this.pool(kind, queue);
      }
    }
    let next = Infinity;
    for (const w of this.waiting) {
      const pool = this.pool(w.kind, w.queue);
      w.conn.send({ t: 'queueState', kind: w.kind, queue: w.queue, searching: pool.length, waitedMs: now - w.since });
      const fill = this.fillMs(w.queue);
      if (fill !== null && pool.length >= QUEUE_SIZES[w.queue].min && w.since + fill > now) next = Math.min(next, w.since + fill);
      if (this.opts.aiFillMs) next = Math.min(next, Math.max(w.aiAt, now));
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

  /** Open a queue room for these players (plus AI opponents); its lobby counts down and then starts with exactly them. */
  private seat(group: Waiting[], ai: AiProfile[] = []): void {
    this.waiting = this.waiting.filter((w) => !group.includes(w));
    const room = this.open({ kind: group[0].kind, queue: group[0].queue });
    for (const w of group) this.enter(w.conn, room, () => room.join(w.conn, w.name));
    for (const p of ai) room.addAi({ ...p, offset: Math.round((this.random() * 2 - 1) * AI_RATING_SPREAD) });
    room.startCountdown(this.opts.quickStartMs);
  }

  /** The oldest searcher waited long enough: seat whoever can play with them, and AI opponents in the rest of a table. */
  private fillWithAi(pool: Waiting[]): void {
    const { min, max } = QUEUE_SIZES[pool[0].queue];
    const group = this.pick(pool, max);
    // A table size people would pick: at least the queue's minimum, never fewer seats than people.
    const lo = Math.max(min, group.length);
    const size = lo + Math.floor(this.random() * (max - lo + 1));
    this.seat(group, this.aiFor(group, size - group.length));
  }

  /** `n` different profiles none of these players met recently (falls back to any free one if the pool runs short). */
  private aiFor(group: Waiting[], n: number): AiProfile[] {
    const keys = group.map((w) => w.account ?? `guest:${w.name}`);
    const recent = new Set(keys.flatMap((k) => this.aiSeen.get(k) ?? []));
    const fresh = AI_PROFILES.filter((p) => !recent.has(p.username));
    const pool = fresh.length >= n ? fresh : [...AI_PROFILES];
    const out: AiProfile[] = [];
    while (out.length < n && pool.length > 0) out.push(...pool.splice(Math.floor(this.random() * pool.length), 1));
    for (const k of keys) {
      const list = [...(this.aiSeen.get(k) ?? []), ...out.map((p) => p.username)].slice(-AI_RECENT);
      this.aiSeen.delete(k);
      this.aiSeen.set(k, list);
    }
    while (this.aiSeen.size > AI_RECENT_PLAYERS) this.aiSeen.delete(this.aiSeen.keys().next().value!);
    return out;
  }

  private aiDelay(): number {
    const range = this.opts.aiFillMs;
    if (!range) return Infinity;
    return range[0] + Math.floor(this.random() * (range[1] - range[0] + 1));
  }

  private random(): number {
    return (this.opts.random ?? Math.random)();
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
