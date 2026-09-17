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
}

const DURATION_MS = 2500;

class Toasts extends Emitter {
  list: Toast[] = [];
  private next = 1;

  show(message: string, tone: Toast["tone"] = "ok", { action, durationMs = DURATION_MS }: ToastOptions = {}) {
    const id = this.next++;
    this.list = [...this.list, { id, message, tone, action }].slice(-3);
    this.emit();
    window.setTimeout(() => this.dismiss(id), durationMs);
  }

  dismiss(id: number) {
    this.list = this.list.filter((t) => t.id !== id);
    this.emit();
  }
}

export const toasts = new Toasts();

/** Brief confirmation that an action happened. */
export const toast = (message: string, tone?: Toast["tone"], options?: ToastOptions) =>
  toasts.show(message, tone, options);
