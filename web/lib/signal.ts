export interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export type SignalMessage =
  | { t: "peer"; online: boolean }
  | { t: "join"; id: number }
  | { t: "leave"; id: number }
  | { t: "signal"; from?: number; data: SignalData };

type Hello = { role: "sender"; token: string } | { role: "receiver" };

/** WebSocket to the server's rendezvous endpoint, reconnecting until closed. */
export class Signal {
  private ws?: WebSocket;
  private closed = false;
  private attempts = 0;
  private timer = 0;

  constructor(
    private readonly code: string,
    private readonly hello: Hello,
    private readonly onMessage: (msg: SignalMessage) => void,
  ) {
    this.connect();
  }

  send(msg: { t: "signal"; to?: number; data: SignalData }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
  }

  private connect() {
    if (this.closed) return;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${window.location.host}/api/transfers/${this.code}/signal`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      ws.send(JSON.stringify(this.hello));
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {
        // Ignore malformed messages.
      }
    };
    ws.onclose = () => {
      if (!this.closed) this.timer = window.setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.attempts++));
    };
  }
}
