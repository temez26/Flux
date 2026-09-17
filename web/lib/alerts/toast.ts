import { Emitter } from "../util/observable";

/** One thing the toast offers to do, e.g. take back what just happened. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: "ok" | "err";
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** How long it stays. An offer worth making needs longer than a confirmation. */
  durationMs?: number;
  /** Runs once it has gone without its action being taken: the moment an offer lapses. */
  onLapse?: () => void;
}

const DURATION_MS = 2500;
const KEPT = 3;

interface Timing {
  durationMs: number;
  timer: number;
  onLapse?: () => void;
}

class Toasts extends Emitter {
  list: Toast[] = [];
  private next = 1;
  private readonly timings = new Map<number, Timing>();
  private held = false;

  show(message: string, tone: Toast["tone"] = "ok", { action, durationMs = DURATION_MS, onLapse }: ToastOptions = {}) {
    const id = this.next++;
    this.timings.set(id, { durationMs, timer: 0, onLapse });
    this.list = [...this.list, { id, message, tone, action }];
    if (!this.held) this.start(id);
    this.emit();
    // Only the last few are kept, so they can't stack up forever; one pushed out has lapsed.
    for (const old of this.list.slice(0, -KEPT)) this.lapse(old.id);
  }

  /** Takes a toast away without it lapsing: its action was taken. */
  dismiss(id: number) {
    window.clearTimeout(this.timings.get(id)?.timer);
    this.timings.delete(id);
    this.list = this.list.filter((t) => t.id !== id);
    // A held toast can leave without the pointer or focus ever leaving it first.
    if (!this.list.length) this.held = false;
    this.emit();
  }

  /**
   * Keeps every toast up while someone is reading one or reaching for its action, which can
   * take far longer than a glance with a screen reader, a keyboard or a switch.
   */
  hold() {
    this.held = true;
    for (const timing of this.timings.values()) window.clearTimeout(timing.timer);
  }

  /** Lets them go again, each with its whole time over, so none vanishes the moment it's let go. */
  release() {
    if (!this.held) return;
    this.held = false;
    for (const id of this.timings.keys()) this.start(id);
  }

  private start(id: number) {
    const timing = this.timings.get(id);
    if (timing) timing.timer = window.setTimeout(() => this.lapse(id), timing.durationMs);
  }

  private lapse(id: number) {
    const onLapse = this.timings.get(id)?.onLapse;
    this.dismiss(id);
    onLapse?.();
  }
}

export const toasts = new Toasts();

/** Brief confirmation that an action happened. */
export const toast = (message: string, tone?: Toast["tone"], options?: ToastOptions) =>
  toasts.show(message, tone, options);
