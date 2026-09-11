import { errorMessage, fileUrl, type TransferMeta } from "./api";
import type { DirectClient } from "./direct";
import { acquireHasher, releaseHasher } from "./hash";
import { Observable, SpeedMeter } from "./observable";
import type { FileWriter, Target } from "./zip";

export type ReceiveStatus = "pending" | "active" | "done" | "failed";

export interface ReceiveItem {
  readonly idx: number;
  readonly path: string;
  readonly size: number;
  readonly modified: number | null;
  received: number;
  status: ReceiveStatus;
  source?: "direct" | "server";
  /** Waiting to retry after the source dropped out. */
  reconnecting?: boolean;
  error?: string;
}

export interface ReceiveSnapshot {
  total: number;
  received: number;
  done: number;
  speed: number;
}

const WAIT_MS = 2000;
const MAX_BACKOFF_MS = 10_000;

class Canceled extends Error {
  constructor() {
    super("Canceled");
  }
}

/** Failure to save, as opposed to failure to fetch; saving can't be retried. */
class SaveFailed extends Error {}

async function* serverChunks(url: string, offset: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const res = await fetch(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal, cache: "no-store" });
  if (!res.body || !(res.status === 206 || (res.status === 200 && offset === 0))) {
    throw new Error(`Server error (${res.status})`);
  }
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Receives files in order into a download target, taking each file from the server when it
 * has it and directly from the sender otherwise. Connection trouble never fails a file: it
 * waits, then resumes from the same byte from whichever source is available.
 */
export class Receiver extends Observable {
  readonly items: ReceiveItem[];
  paused = false;
  finished = false;
  error?: string;
  snapshot: ReceiveSnapshot = { total: 0, received: 0, done: 0, speed: 0 };
  private readonly code: string;
  private readonly hashes: Map<number, string | null>;
  private readonly meter = new SpeedMeter();
  private canceled = false;
  private usedDirect = false;
  private controller?: AbortController;
  private wake?: () => void;

  constructor(
    meta: TransferMeta,
    private readonly direct: DirectClient,
    private readonly target: Target,
  ) {
    super();
    this.items = meta.files.map((f) => ({
      idx: f.idx,
      path: f.path,
      size: f.size,
      modified: f.modified,
      received: 0,
      status: "pending",
    }));
    this.hashes = new Map(meta.files.map((f) => [f.idx, f.hash]));
    this.code = meta.code;
    this.refresh();
  }

  /** Newer server state: files that finished uploading can now come from the server. */
  update(meta: TransferMeta) {
    for (const f of meta.files) if (f.hash) this.hashes.set(f.idx, f.hash);
    this.wake?.();
  }

  start() {
    void this.run();
  }

  pause() {
    this.paused = true;
    this.meter.reset();
    this.controller?.abort();
    this.changed();
  }

  resume() {
    this.paused = false;
    this.meter.reset();
    this.wake?.();
    this.changed();
  }

  cancel() {
    this.canceled = true;
    this.controller?.abort();
    this.wake?.();
  }

  protected get busy() {
    return !this.finished;
  }

  protected refresh() {
    let total = 0;
    let received = 0;
    let done = 0;
    for (const item of this.items) {
      total += item.size;
      received += item.received;
      if (item.status === "done") done++;
    }
    this.snapshot = { total, received, done, speed: this.meter.update(received) };
  }

  private async run() {
    try {
      for (const item of this.items) await this.receive(item);
      await this.target.finish();
      if (this.usedDirect) this.direct.done();
    } catch (err) {
      this.target.abort();
      this.error = err instanceof Canceled ? "Canceled" : errorMessage(err);
      for (const item of this.items) if (item.status !== "done") item.status = "failed";
    } finally {
      this.finished = true;
      this.changed();
    }
  }

  private source(item: ReceiveItem): ReceiveItem["source"] {
    if (this.hashes.get(item.idx)) return "server";
    if (this.direct.state === "open") return "direct";
    return undefined;
  }

  private async receive(item: ReceiveItem) {
    const blake3 = await acquireHasher("blake3");
    const crc = await acquireHasher("crc32");
    try {
      let writer: FileWriter | undefined;
      let attempts = 0;
      while (!writer || item.received < item.size) {
        await this.ready();
        const source = this.source(item);
        if (!source && item.size > 0) {
          item.status = "pending";
          this.changed();
          await this.sleep(WAIT_MS);
          continue;
        }
        item.status = "active";
        item.source = source;
        this.changed();
        writer ??= await this.target.begin(item);
        if (item.received === item.size) break;

        const controller = (this.controller = new AbortController());
        try {
          const chunks =
            source === "server"
              ? serverChunks(fileUrl(this.code, item.idx), item.received, controller.signal)
              : this.direct.read(item.idx, item.received, item.size, controller.signal);
          for await (const chunk of chunks) {
            await writer.write(chunk).catch((err) => {
              throw new SaveFailed(errorMessage(err));
            });
            blake3.update(chunk);
            crc.update(chunk);
            item.received += chunk.length;
            item.reconnecting = false;
            attempts = 0;
            if (source === "direct") this.usedDirect = true;
            this.changed();
          }
          if (item.received !== item.size) throw new Error("The transfer ended early");
        } catch (err) {
          if (err instanceof SaveFailed) throw err;
          if (this.paused || this.canceled) continue;
          item.reconnecting = true;
          this.changed();
          await this.sleep(Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempts++));
        }
      }

      if (item.size > 0 && blake3.digest("hex") !== (await this.expectedHash(item))) {
        throw new Error(`${item.path} failed its integrity check`);
      }
      await writer.end(parseInt(crc.digest("hex"), 16));
      item.status = "done";
      item.reconnecting = false;
      this.changed();
    } catch (err) {
      if (!(err instanceof Canceled)) item.error = errorMessage(err);
      throw err;
    } finally {
      releaseHasher("blake3", blake3);
      releaseHasher("crc32", crc);
    }
  }

  private async expectedHash(item: ReceiveItem): Promise<string> {
    for (;;) {
      const known = this.hashes.get(item.idx);
      if (known) return known;
      if (this.direct.state === "open") {
        try {
          return await this.direct.hash(item.idx);
        } catch {
          // Retried below.
        }
      }
      await this.sleep(WAIT_MS);
      await this.ready();
    }
  }

  private async ready() {
    while (this.paused && !this.canceled) await this.sleep(60_000);
    if (this.canceled) throw new Canceled();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = window.setTimeout(done, ms);
      this.wake = done;
    });
  }
}
