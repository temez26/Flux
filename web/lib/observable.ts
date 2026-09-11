const TICK_MS = 250;
const SPEED_WINDOW_MS = 5000;

/** Change notifications for useSyncExternalStore. */
export class Emitter {
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  protected emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Emitter for fast-changing progress: notifications are batched, and keep ticking while
 * `busy` so rates stay current even when progress stalls.
 */
export abstract class Observable extends Emitter {
  private timer = 0;

  protected abstract refresh(): void;
  protected abstract get busy(): boolean;

  protected changed() {
    if (!this.timer) this.timer = window.setTimeout(this.tick, TICK_MS);
  }

  protected stopTicking() {
    window.clearTimeout(this.timer);
  }

  private tick = () => {
    this.timer = 0;
    this.refresh();
    this.emit();
    if (this.busy) this.changed();
  };
}

/** Bytes per second over a sliding window. */
export class SpeedMeter {
  private samples: [number, number][] = [];
  private speed = 0;

  reset() {
    this.samples = [];
    this.speed = 0;
  }

  update(bytes: number): number {
    const now = performance.now();
    const samples = this.samples;
    samples.push([now, bytes]);
    while (samples.length > 2 && now - samples[0][0] > SPEED_WINDOW_MS) samples.shift();
    const [t0, b0] = samples[0];
    if (now - t0 >= 1000) this.speed = Math.max(0, ((bytes - b0) * 1000) / (now - t0));
    return this.speed;
  }
}
