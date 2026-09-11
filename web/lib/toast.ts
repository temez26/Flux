import { Emitter } from "./observable";

export interface Toast {
  id: number;
  message: string;
  tone: "ok" | "err";
}

const DURATION_MS = 2500;

class Toasts extends Emitter {
  list: Toast[] = [];
  private next = 1;

  show(message: string, tone: Toast["tone"] = "ok") {
    const id = this.next++;
    this.list = [...this.list, { id, message, tone }].slice(-3);
    this.emit();
    window.setTimeout(() => this.dismiss(id), DURATION_MS);
  }

  private dismiss(id: number) {
    this.list = this.list.filter((t) => t.id !== id);
    this.emit();
  }
}

export const toasts = new Toasts();

/** Brief confirmation that an action happened. */
export const toast = (message: string, tone?: Toast["tone"]) => toasts.show(message, tone);
