import type { IHasher } from "hash-wasm";
import { acquireHasher, releaseHasher, updateInSlices } from "./hash";
import { Emitter, Observable } from "./observable";
import { Signal, type SignalData, type SignalMessage } from "./signal";

// Data channel frames: binary = [u32 request id][payload], text = JSON control messages.
const HEADER = 4;
const FRAME = 64 * 1024;
const RANGE = 1024 * 1024;
// Receiver: bytes requested but not yet consumed. Bounds memory when saving is slower than the network.
const WINDOW = 8 * 1024 * 1024;
// Sender: stop queueing frames while this much is buffered in the channel.
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;
const HASH_READ = 8 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_CONNECT_ATTEMPTS = 3;

type Request =
  | { t: "get"; id: number; idx: number; offset: number; length: number }
  | { t: "hash"; id: number; idx: number }
  | { t: "done" };

type Reply = { t: "hash"; id: number; hash: string } | { t: "error"; id: number; message: string };

interface Peer {
  pc: RTCPeerConnection;
  signal(data: SignalData): Promise<void>;
}

function createPeer(onCandidate: (candidate: RTCIceCandidateInit) => void): Peer {
  // Devices on the same network reach each other through host candidates, so no
  // third-party STUN or TURN server is ever contacted.
  const pc = new RTCPeerConnection({ iceServers: [] });
  const early: RTCIceCandidateInit[] = [];
  pc.onicecandidate = (e) => {
    if (e.candidate) onCandidate(e.candidate.toJSON());
  };
  return {
    pc,
    async signal(data) {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const candidate of early.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
      }
      if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else early.push(data.candidate);
      }
    },
  };
}

function drained(channel: RTCDataChannel) {
  return new Promise<void>((resolve) => {
    channel.addEventListener("bufferedamountlow", () => resolve(), { once: true });
    channel.addEventListener("close", () => resolve(), { once: true });
  });
}

const failure = (err: unknown) => (err instanceof Error ? err.message : "Failed");

export interface HostEvents {
  /** A receiver asked for data, so the server upload should yield bandwidth. */
  activity(): void;
  /** A receiver finished receiving everything. */
  delivered(): void;
}

/** Sender side: serves the transfer's files to receivers over WebRTC data channels. */
export class DirectHost extends Observable {
  /** Bytes sent directly since this page opened. */
  sent = 0;
  private readonly peers = new Map<number, Peer>();
  private readonly channels = new Set<RTCDataChannel>();
  private readonly signal: Signal;

  constructor(
    code: string,
    token: string,
    private readonly file: (idx: number) => File | undefined,
    private readonly events: HostEvents,
  ) {
    super();
    this.signal = new Signal(code, { role: "sender", token }, (msg) => void this.onSignal(msg));
  }

  /** Receivers with an open direct connection. */
  get receivers() {
    return this.channels.size;
  }

  close() {
    this.signal.close();
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.stopTicking();
  }

  protected get busy() {
    return this.channels.size > 0;
  }

  protected refresh() {}

  private async onSignal(msg: SignalMessage) {
    if (msg.t === "leave") {
      this.peers.get(msg.id)?.pc.close();
      this.peers.delete(msg.id);
      return;
    }
    if (msg.t !== "signal" || msg.from === undefined) return;
    const from = msg.from;
    try {
      if (msg.data.sdp?.type === "offer") {
        this.peers.get(from)?.pc.close();
        const peer = createPeer((candidate) => this.signal.send({ t: "signal", to: from, data: { candidate } }));
        this.peers.set(from, peer);
        peer.pc.ondatachannel = (e) => this.serve(e.channel);
        await peer.signal(msg.data);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.signal.send({ t: "signal", to: from, data: { sdp: peer.pc.localDescription!.toJSON() } });
      } else {
        await this.peers.get(from)?.signal(msg.data);
      }
    } catch {
      // A failed negotiation leaves that receiver on the server path.
    }
  }

  private serve(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_WATER;
    const queue: Request[] = [];
    // Running hashes for files read from the start, so hash requests rarely re-read a file.
    const hashes = new Map<number, { hasher: IHasher; pos: number }>();
    let draining = false;

    const drain = async () => {
      draining = true;
      while (queue.length && channel.readyState === "open") {
        const req = queue.shift()!;
        if (req.t === "done") continue;
        try {
          if (req.t === "get") await this.sendRange(channel, req, hashes);
          else await this.sendHash(channel, req, hashes);
        } catch (err) {
          if (channel.readyState === "open") channel.send(JSON.stringify({ t: "error", id: req.id, message: failure(err) }));
        }
      }
      draining = false;
    };

    const open = () => {
      this.channels.add(channel);
      this.changed();
    };
    if (channel.readyState === "open") open();
    else channel.onopen = open;
    channel.onclose = () => {
      this.channels.delete(channel);
      this.changed();
    };
    channel.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const req = JSON.parse(e.data) as Request;
      if (req.t === "done") return this.events.delivered();
      if (req.t === "get") this.events.activity();
      queue.push(req);
      if (!draining) void drain();
    };
  }

  private async sendRange(
    channel: RTCDataChannel,
    req: Extract<Request, { t: "get" }>,
    hashes: Map<number, { hasher: IHasher; pos: number }>,
  ) {
    const file = this.file(req.idx);
    if (!file) throw new Error("This file isn't available from the sender");
    const end = Math.min(file.size, req.offset + req.length);
    const data = new Uint8Array(await file.slice(req.offset, end).arrayBuffer());

    let running = hashes.get(req.idx);
    if (!running && req.offset === 0) hashes.set(req.idx, (running = { hasher: await acquireHasher("blake3"), pos: 0 }));
    if (running?.pos === req.offset) {
      running.hasher.update(data);
      running.pos = end;
    }

    for (let pos = 0; pos < data.length; pos += FRAME - HEADER) {
      const chunk = data.subarray(pos, pos + FRAME - HEADER);
      const frame = new Uint8Array(HEADER + chunk.length);
      new DataView(frame.buffer).setUint32(0, req.id, true);
      frame.set(chunk, HEADER);
      if (channel.bufferedAmount > HIGH_WATER) await drained(channel);
      if (channel.readyState !== "open") return;
      channel.send(frame);
      this.sent += chunk.length;
    }
    this.changed();
  }

  private async sendHash(
    channel: RTCDataChannel,
    req: Extract<Request, { t: "hash" }>,
    hashes: Map<number, { hasher: IHasher; pos: number }>,
  ) {
    const file = this.file(req.idx);
    if (!file) throw new Error("This file isn't available from the sender");
    const running = hashes.get(req.idx) ?? { hasher: await acquireHasher("blake3"), pos: 0 };
    hashes.delete(req.idx);
    while (running.pos < file.size) {
      const end = Math.min(file.size, running.pos + HASH_READ);
      await updateInSlices(running.hasher, new Uint8Array(await file.slice(running.pos, end).arrayBuffer()));
      running.pos = end;
    }
    const hash = running.hasher.digest("hex");
    releaseHasher("blake3", running.hasher);
    if (channel.readyState === "open") channel.send(JSON.stringify({ t: "hash", id: req.id, hash }));
  }
}

export type DirectState = "waiting" | "connecting" | "open" | "unavailable";

interface Pending {
  remaining: number;
  onData(chunk: Uint8Array): void;
  fail(err: Error): void;
}

/** Receiver side: a data channel to the sender, used to read file ranges directly. */
export class DirectClient extends Emitter {
  state: DirectState = "waiting";
  private readonly signal: Signal;
  private peer?: Peer;
  private channel?: RTCDataChannel;
  private closed = false;
  private attempts = 0;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly hashes = new Map<number, { resolve(hash: string): void; reject(err: Error): void }>();

  constructor(code: string) {
    super();
    this.signal = new Signal(code, { role: "receiver" }, (msg) => void this.onSignal(msg));
  }

  close() {
    this.closed = true;
    this.signal.close();
    this.teardown();
  }

  /** Streams bytes `offset..size` of a file, keeping a bounded window of requests in flight. */
  async *read(idx: number, offset: number, size: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const ids: number[] = [];
    let error: Error | undefined;
    let wake: (() => void) | undefined;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const abort = () => {
      error = new Error("Aborted");
      notify();
    };
    signal.addEventListener("abort", abort);
    let requested = offset;
    let consumed = offset;
    try {
      while (consumed < size) {
        while (requested < size && requested - consumed < WINDOW) {
          const length = Math.min(RANGE, size - requested);
          const id = this.nextId++;
          this.pending.set(id, {
            remaining: length,
            onData: (chunk) => {
              chunks.push(chunk);
              notify();
            },
            fail: (err) => {
              error = err;
              notify();
            },
          });
          ids.push(id);
          this.send({ t: "get", id, idx, offset: requested, length });
          requested += length;
        }
        if (error) throw error;
        const chunk = chunks.shift();
        if (chunk) {
          consumed += chunk.length;
          yield chunk;
        } else {
          await new Promise<void>((resolve) => (wake = resolve));
        }
      }
    } finally {
      signal.removeEventListener("abort", abort);
      for (const id of ids) this.pending.delete(id);
    }
  }

  /** The sender's BLAKE3 of a file, to verify what arrived. */
  hash(idx: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.hashes.set(id, { resolve, reject });
      try {
        this.send({ t: "hash", id, idx });
      } catch (err) {
        this.hashes.delete(id);
        reject(err);
      }
    });
  }

  /** Tells the sender that everything arrived. */
  done() {
    try {
      this.send({ t: "done" });
    } catch {
      // Nothing to tell if the connection is gone.
    }
  }

  private send(req: Request) {
    if (this.channel?.readyState !== "open") throw new Error("Direct connection lost");
    this.channel.send(JSON.stringify(req));
  }

  private setState(state: DirectState) {
    if (this.state === state) return;
    this.state = state;
    this.emit();
  }

  private async onSignal(msg: SignalMessage) {
    if (msg.t === "peer") {
      if (msg.online) {
        this.attempts = 0;
        if (this.state !== "open" && this.state !== "connecting") void this.connect();
      } else if (this.state !== "open") {
        this.setState("waiting");
      }
    } else if (msg.t === "signal") {
      await this.peer?.signal(msg.data).catch(() => {});
    }
  }

  private async connect() {
    if (this.closed) return;
    this.teardown();
    this.attempts++;
    this.setState("connecting");
    const peer = createPeer((candidate) => this.signal.send({ t: "signal", data: { candidate } }));
    const channel = peer.pc.createDataChannel("flux", { ordered: true });
    this.peer = peer;
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    const timer = window.setTimeout(() => this.lost(channel), CONNECT_TIMEOUT_MS);
    channel.onopen = () => {
      window.clearTimeout(timer);
      this.attempts = 0;
      this.setState("open");
    };
    channel.onclose = () => {
      window.clearTimeout(timer);
      this.lost(channel);
    };
    channel.onmessage = (e) => this.onMessage(e.data);
    peer.pc.onconnectionstatechange = () => {
      if (peer.pc.connectionState === "failed") this.lost(channel);
    };
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.signal.send({ t: "signal", data: { sdp: peer.pc.localDescription!.toJSON() } });
    } catch {
      this.lost(channel);
    }
  }

  private lost(channel: RTCDataChannel) {
    if (this.channel !== channel) return;
    this.teardown();
    const err = new Error("Direct connection lost");
    for (const pending of this.pending.values()) pending.fail(err);
    this.pending.clear();
    for (const waiter of this.hashes.values()) waiter.reject(err);
    this.hashes.clear();
    if (this.closed) return;
    if (this.attempts < MAX_CONNECT_ATTEMPTS) {
      this.setState("connecting");
      window.setTimeout(() => void this.connect(), 2000);
    } else {
      this.setState("unavailable");
    }
  }

  private teardown() {
    const channel = this.channel;
    this.channel = undefined;
    channel?.close();
    this.peer?.pc.close();
    this.peer = undefined;
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const reply = JSON.parse(data) as Reply;
      const waiter = this.hashes.get(reply.id);
      this.hashes.delete(reply.id);
      if (reply.t === "hash") {
        waiter?.resolve(reply.hash);
      } else {
        const err = new Error(reply.message);
        waiter?.reject(err);
        this.pending.get(reply.id)?.fail(err);
        this.pending.delete(reply.id);
      }
      return;
    }
    const id = new DataView(data).getUint32(0, true);
    const pending = this.pending.get(id);
    if (!pending) return; // an abandoned request
    const chunk = new Uint8Array(data, HEADER);
    pending.remaining -= chunk.length;
    if (pending.remaining <= 0) this.pending.delete(id);
    pending.onData(chunk);
  }
}
