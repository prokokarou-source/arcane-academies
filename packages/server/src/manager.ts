import type { ClientMessage } from '@arcane/protocol';
import type { Clock } from './clock';
import { generateCode, normalizeCode } from './codes';
import { Room, type Conn, type RoomOptions } from './room';

export interface ManagerOptions extends RoomOptions {
  /** A room with no client message for this long is closed. */
  idleMs: number;
  /** How often idle and closed rooms are swept. */
  sweepMs: number;
}

export const DEFAULT_MANAGER_OPTIONS: ManagerOptions = {
  clientUrl: 'http://localhost:5173',
  idleMs: 30 * 60_000,
  sweepMs: 60_000,
};

/** Owns every room: creates them, routes client messages, expires idle ones. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private connRoom = new Map<Conn, Room>();
  private readonly opts: ManagerOptions;
  private sweepTimer: unknown = null;

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

  size(): number {
    return this.rooms.size;
  }

  onMessage(conn: Conn, msg: ClientMessage): void {
    switch (msg.t) {
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
    for (const room of this.rooms.values()) room.close('expired');
    this.rooms.clear();
    this.connRoom.clear();
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
