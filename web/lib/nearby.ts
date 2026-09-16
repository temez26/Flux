import { getDevice, renameDevice, type Device } from "./device";
import { Emitter } from "./observable";

export interface Peer {
  device: string;
  name: string;
}

/** An invitation to open a transfer another device has already created. */
export interface Offer {
  from: Peer;
  code: string;
  title: string;
  files: number;
  size: number;
}

export interface Answer {
  from: Peer;
  code: string;
  accepted: boolean;
}

type ServerMessage =
  | { t: "peers"; peers: Peer[] }
  | { t: "peer"; device: string; name: string }
  | { t: "gone"; device: string }
  | ({ t: "offer" } & Offer)
  | ({ t: "answer" } & Answer);

/** The part of a WebSocket this uses, so tests can stand one in. */
export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

const OPEN = 1;
/** Offers left unanswered pile up, and only the latest few are still worth showing. */
const MAX_OFFERS = 5;
const MAX_BACKOFF_MS = 10_000;

/**
 * What a transfer is called when it is offered: the dropped folder's name, or the first
 * file's — the same rule the server uses for its own listings.
 */
export function offerTitle(paths: string[]): string {
  const first = paths[0] ?? "";
  const top = first.split("/")[0];
  const oneFolder = paths.length > 1 && first.includes("/") && paths.every((p) => p.split("/")[0] === top);
  return oneFolder ? top : first.slice(first.lastIndexOf("/") + 1);
}

/**
 * This page's presence on the network: who else is here, offers that arrive for this
 * device, and a way to offer a transfer to someone. Reconnects until closed, announcing
 * itself again each time, because the server forgets a device the moment it drops.
 */
export class Nearby extends Emitter {
  peers: Peer[] = [];
  offers: Offer[] = [];
  connected = false;
  device: Device = getDevice();
  private ws?: SocketLike;
  private closed = false;
  private attempts = 0;
  private timer = 0;

  constructor(
    private readonly open: () => SocketLike,
    private readonly onAnswer: (answer: Answer) => void,
  ) {
    super();
    this.connect();
  }

  offer(to: Peer, transfer: Omit<Offer, "from">) {
    this.send({ t: "offer", to: to.device, ...transfer });
  }

  /** Accepting or declining both clear the offer; the sender hears which it was. */
  answer(offer: Offer, accepted: boolean) {
    this.offers = this.offers.filter((o) => o !== offer);
    this.send({ t: "answer", to: offer.from.device, code: offer.code, accepted });
    this.emit();
  }

  rename(name: string) {
    this.device = renameDevice(name);
    this.send({ t: "rename", name: this.device.name });
    this.emit();
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
  }

  private send(msg: object) {
    if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    if (this.closed) return;
    const ws = (this.ws = this.open());
    ws.onopen = () => {
      this.attempts = 0;
      this.connected = true;
      ws.send(JSON.stringify({ device: this.device.id, name: this.device.name }));
      this.emit();
    };
    ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(e.data));
      } catch {
        // Ignore malformed messages.
      }
    };
    ws.onclose = () => {
      this.connected = false;
      // Whoever was listed may be long gone by the time this reconnects.
      this.peers = [];
      this.emit();
      if (!this.closed) this.timer = window.setTimeout(() => this.connect(), Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts++));
    };
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case "peers":
        this.peers = msg.peers;
        break;
      case "peer":
        this.peers = [...this.peers.filter((p) => p.device !== msg.device), { device: msg.device, name: msg.name }];
        this.peers.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "gone":
        this.peers = this.peers.filter((p) => p.device !== msg.device);
        break;
      case "offer": {
        const offer: Offer = { from: msg.from, code: msg.code, title: msg.title, files: msg.files, size: msg.size };
        // The same transfer offered twice, from a sender who tapped again, is one offer.
        this.offers = [...this.offers.filter((o) => o.code !== offer.code), offer].slice(-MAX_OFFERS);
        break;
      }
      case "answer":
        this.onAnswer({ from: msg.from, code: msg.code, accepted: msg.accepted });
        return;
    }
    this.emit();
  }
}
