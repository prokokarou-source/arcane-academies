/** Time source and timers, injectable so rooms can be tested with a manual clock. */
export interface Clock {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    // A failing room timer must not take the whole server down.
    const t = setTimeout(() => {
      try {
        fn();
      } catch (e) {
        console.error('timer callback failed', e);
      }
    }, ms);
    t.unref?.();
    return t;
  },
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface ManualTimer {
  id: number;
  at: number;
  fn: () => void;
}

/** A clock that only moves when told to. Timers fire in time order (ties by creation order). */
export class ManualClock implements Clock {
  private time: number;
  private timers: ManualTimer[] = [];
  private nextId = 1;

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimer(ms: number, fn: () => void): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + Math.max(0, ms), fn });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.time = Math.max(this.time, due.at);
      due.fn();
    }
    this.time = end;
  }
}
