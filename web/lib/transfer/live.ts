import type { SocketLike } from "../nearby/nearby";

type LiveMessage = { t: "changed" } | { t: "viewers"; count: number };

const MAX_BACKOFF_MS = 10_000;

/**
 * Hears the moment an open text changes, and how many pages have it open, while it stays open.
 * Reconnects until closed; changes made while disconnected went unheard, so coming back counts
 * as one.
 */
export class NoteLive {
  private ws?: SocketLike;
  private closed = false;
  private attempts = 0;
  private timer = 0;
  private dropped = false;

  constructor(
    private readonly open: () => SocketLike,
    private readonly onChange: () => void,
    /** How many pages have the text open, this one included; 0 while not connected. */
    private readonly onViewers: (count: number) => void,
  ) {
    this.connect();
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
  }

  private connect() {
    if (this.closed) return;
    const ws = (this.ws = this.open());
    ws.onopen = () => {
      this.attempts = 0;
      if (this.dropped) this.onChange();
      this.dropped = false;
    };
    ws.onmessage = (e) => {
      let msg: LiveMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === "changed") this.onChange();
      else if (msg.t === "viewers") this.onViewers(msg.count);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.dropped = true;
      this.onViewers(0);
      this.timer = window.setTimeout(() => this.connect(), Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts++));
    };
  }
}
