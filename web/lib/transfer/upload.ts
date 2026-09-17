import { deleteFile, fileUrl } from "../api";
import { createHasher, type Hasher } from "./hash";
import { Observable, SpeedMeter } from "../util/observable";

export type Status = "pending" | "active" | "done" | "failed" | "canceled";

export interface Item {
  readonly idx: number;
  readonly path: string;
  readonly size: number;
  sent: number;
  status: Status;
  /** Active, but waiting to retry after a network or server error. */
  reconnecting?: boolean;
  error?: string;
}

export interface Entry {
  idx: number;
  path: string;
  size: number;
  file?: File;
  done?: boolean;
}

export interface Snapshot {
  total: number;
  sent: number;
  counts: Record<Status, number>;
  /** Every active file is waiting to retry. */
  reconnecting: boolean;
  speed: number;
  finished: boolean;
}

interface Task {
  item: Item;
  file?: File;
  /** Bytes the server has confirmed. */
  offset: number;
  hasher?: Hasher;
  /** Bytes fed into `hasher`, always a prefix of the file. */
  hashed: number;
  digest?: string;
  attempts: number;
  /** Retries spent waiting for the server to finish work of its own, counted separately. */
  busy: number;
  xhr?: XMLHttpRequest;
  wake?: () => void;
}

// 8 MiB keeps per-request overhead negligible while bounding memory to CHUNK × CONCURRENCY.
const CHUNK = 8 * 1024 * 1024;
// Small files are latency-bound, so parallelism matters; 6 matches browsers' HTTP/1.1
// per-host connection limit (measured ~50% more files/s than 4).
const CONCURRENCY = 6;
const MAX_ATTEMPTS = 8;
// The server answers 423 while it re-reads a resumed file to recheck what it already holds.
// That is bounded work on data we know it has, so wait it out on its own budget rather than
// spending the error budget, which a large file would exhaust long before the read finished.
const MAX_BUSY_ATTEMPTS = 40;
// A request without progress for this long is presumed dead (e.g. a proxy holding a
// half-open connection after the server restarted) and is retried.
const STALL_MS = 30_000;
const GONE = "Transfer no longer exists";

class Interrupted extends Error {}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { offset?: number; error?: string } | null,
  ) {
    super(status === 0 ? "Connection lost" : (body?.error ?? `Server error (${status})`));
  }
}

const emptyCounts = (): Record<Status, number> => ({ pending: 0, active: 0, done: 0, failed: 0, canceled: 0 });

function taskFor(e: Entry): Task {
  return {
    item: {
      idx: e.idx,
      path: e.path,
      size: e.size,
      sent: e.done ? e.size : 0,
      status: e.done ? "done" : e.file ? "pending" : "failed",
      error: e.done || e.file ? undefined : "Add this file again to resume",
    },
    file: e.file,
    offset: 0,
    hashed: 0,
    attempts: 0,
    busy: 0,
  };
}

/**
 * Upload queue: a few files in flight at once, each sent in resumable chunks and hashed
 * with BLAKE3 on the way so the server can verify it end to end. Files are independent,
 * so one failing never restarts another.
 */
export class Uploader extends Observable {
  readonly items: Item[];
  paused = false;
  /** The transfer expired or was deleted, so nothing more can upload. */
  gone = false;
  snapshot: Snapshot = { total: 0, sent: 0, counts: emptyCounts(), reconnecting: false, speed: 0, finished: false };
  private readonly tasks: Task[];
  private readonly meter = new SpeedMeter();
  private cursor = 0;
  private active = 0;
  private heldUntil = 0;
  private holdTimer = 0;

  constructor(
    readonly code: string,
    readonly token: string,
    entries: Entry[],
  ) {
    super();
    this.tasks = entries.map(taskFor);
    this.items = this.tasks.map((t) => t.item);
    this.refresh();
    window.addEventListener("online", this.onOnline);
  }

  /** Yielding bandwidth to a direct transfer. */
  get held() {
    return performance.now() < this.heldUntil;
  }

  /** Pauses the server upload while a direct transfer runs; it continues once that is idle for `ms`. */
  hold(ms: number) {
    const wasHeld = this.held;
    this.heldUntil = performance.now() + ms;
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      this.heldUntil = 0;
      this.pump();
    }, ms);
    if (!wasHeld) {
      for (const t of this.tasks) if (t.item.status === "active") this.interrupt(t);
      this.changed();
    }
  }

  start() {
    this.pump();
  }

  /** Takes on files added to the transfer after it began; they queue behind everything else. */
  add(entries: Entry[]) {
    if (this.gone) return;
    for (const task of entries.map(taskFor)) {
      this.tasks.push(task);
      this.items.push(task.item);
    }
    this.refresh();
    this.pump();
  }

  pause() {
    this.paused = true;
    for (const t of this.tasks) if (t.item.status === "active") this.interrupt(t);
    this.meter.reset();
    this.changed();
  }

  resume() {
    this.paused = false;
    this.meter.reset();
    this.pump();
  }

  retry(idx?: number) {
    if (this.gone) return;
    for (const t of this.tasks) {
      if (t.item.status === "failed" && t.file && (idx === undefined || t.item.idx === idx)) {
        t.item.status = "pending";
        t.item.error = undefined;
        t.attempts = 0;
        t.busy = 0;
      }
    }
    this.cursor = 0;
    this.pump();
  }

  cancel(idx: number) {
    const t = this.tasks.find((t) => t.item.idx === idx);
    if (!t || t.item.status === "done" || t.item.status === "canceled") return;
    this.forget(idx);
    deleteFile(this.code, this.token, idx).catch(() => {});
  }

  /** Drops a file the server no longer holds, whatever state it had reached here. */
  forget(idx: number) {
    const t = this.tasks.find((t) => t.item.idx === idx);
    if (!t || t.item.status === "canceled") return;
    t.item.status = "canceled";
    this.discardHasher(t);
    this.interrupt(t);
    this.changed();
  }

  /** Stops everything for good because the transfer no longer exists on the server. */
  markGone() {
    if (this.gone) return;
    this.gone = true;
    for (const t of this.tasks) {
      if (t.item.status === "pending" || t.item.status === "active") {
        this.interrupt(t);
        t.item.status = "failed";
        t.item.error = GONE;
      }
    }
    this.changed();
  }

  dispose() {
    this.paused = true;
    for (const t of this.tasks) {
      this.interrupt(t);
      this.discardHasher(t);
    }
    window.removeEventListener("online", this.onOnline);
    window.clearTimeout(this.holdTimer);
    this.stopTicking();
  }

  protected get busy() {
    return this.active > 0;
  }

  protected refresh() {
    const counts = emptyCounts();
    let total = 0;
    let sent = 0;
    let reconnecting = 0;
    for (const item of this.items) {
      counts[item.status]++;
      if (item.reconnecting) reconnecting++;
      if (item.status !== "canceled") {
        total += item.size;
        sent += item.sent;
      }
    }
    this.snapshot = {
      total,
      sent,
      counts,
      reconnecting: counts.active > 0 && reconnecting === counts.active,
      speed: this.meter.update(sent),
      finished: counts.pending + counts.active === 0,
    };
  }

  private onOnline = () => {
    for (const t of this.tasks) t.wake?.();
    this.retry();
  };

  private interrupt(t: Task) {
    t.xhr?.abort();
    t.wake?.();
  }

  private nextPending(): Task | undefined {
    while (this.cursor < this.tasks.length) {
      const task = this.tasks[this.cursor];
      if (task.item.status === "pending") return task;
      this.cursor++;
    }
    return undefined;
  }

  private pump() {
    while (!this.paused && !this.held && !this.gone && this.active < CONCURRENCY) {
      const task = this.nextPending();
      if (!task) break;
      this.active++;
      task.item.status = "active";
      void this.run(task).finally(() => {
        this.active--;
        this.pump();
      });
    }
    this.changed();
  }

  private stopped(t: Task) {
    return this.paused || this.held || this.gone || t.item.status !== "active";
  }

  private async run(t: Task) {
    try {
      while (!this.stopped(t)) {
        try {
          await this.step(t);
        } catch (err) {
          if (err instanceof Interrupted || this.stopped(t)) break;
          if (!(await this.recover(t, err))) break;
        }
      }
    } finally {
      t.item.reconnecting = false;
      if (t.item.status === "active") {
        t.item.status = "pending";
        this.cursor = 0;
      }
      if (t.item.status !== "done") t.item.sent = t.offset;
    }
  }

  private async step(t: Task) {
    const { item } = t;
    const start = t.offset;
    const end = Math.min(start + CHUNK, item.size);
    const last = end === item.size;
    const hasher = (t.hasher ??= createHasher());
    if (t.hashed < start) await this.hashUntil(t, start);
    const data = await this.read(t, start, end);

    // Only the last request carries a digest, so every other chunk is hashed while it is
    // already on its way to the server rather than before it sets off. `hashed` can also
    // already be past `start`, when a send failed after its bytes were hashed.
    const hashing = t.hashed < end ? this.hash(t, hasher, data, t.hashed - start, end) : undefined;
    try {
      if (last) {
        await hashing;
        if (t.hashed < end) throw new Error("Can't read this file");
        t.digest ??= await hasher.digest();
      }
      const res = await this.send(t, start, data, last ? t.digest : undefined);
      t.offset = item.sent = res.offset;
      t.attempts = 0;
      t.busy = 0;
      if (res.complete) {
        item.status = "done";
        this.discardHasher(t);
      }
    } finally {
      // The next chunk must not be fed in before this one has landed, whatever the send did.
      await hashing;
      if (t.hashed < end && t.hasher) this.resetHash(t);
    }
  }

  /** Resolves once the chunk has reached the hasher, recording how far the digest covers. */
  private hash(t: Task, hasher: Hasher, data: Uint8Array<ArrayBuffer>, from: number, through: number): Promise<void> {
    // Never rejects: a failure is read off `hashed`, so nothing is left unobserved while
    // the request this ran alongside is still in flight.
    return hasher.update(data, from).then(
      () => void (t.hashed = through),
      () => {},
    );
  }

  /** A half-fed digest can't be rewound, so a broken one starts again from the first byte. */
  private resetHash(t: Task) {
    this.discardHasher(t);
    t.hashed = 0;
    t.digest = undefined;
  }

  private async read(t: Task, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    const data = new Uint8Array(await t.file!.slice(start, end).arrayBuffer());
    if (this.stopped(t)) throw new Interrupted();
    return data;
  }

  /** Catches the hash up when the server already holds more of the file than we hashed. */
  private async hashUntil(t: Task, until: number) {
    while (t.hashed < until) {
      const end = Math.min(t.hashed + CHUNK, until);
      await t.hasher!.update(await this.read(t, t.hashed, end));
      t.hashed = end;
    }
  }

  /** A digest can't be rewound, so restarting one means letting the old hasher go. */
  private discardHasher(t: Task) {
    t.hasher?.release();
    t.hasher = undefined;
  }

  private send(t: Task, offset: number, data: Uint8Array<ArrayBuffer>, digest?: string) {
    return new Promise<{ offset: number; complete: boolean }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let stalled = false;
      let watchdog = 0;
      const arm = () => {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => {
          stalled = true;
          xhr.abort();
        }, STALL_MS);
      };
      const settle = () => {
        window.clearTimeout(watchdog);
        t.xhr = undefined;
      };
      t.xhr = xhr;
      xhr.open("PATCH", fileUrl(this.code, t.item.idx));
      xhr.responseType = "json";
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("Upload-Offset", String(offset));
      if (digest) xhr.setRequestHeader("Upload-Hash", digest);
      xhr.upload.onprogress = (e) => {
        arm();
        t.item.sent = offset + e.loaded;
        this.changed();
      };
      xhr.onload = () => {
        settle();
        if (xhr.status === 200 && xhr.response) resolve(xhr.response);
        else reject(new HttpError(xhr.status, xhr.response));
      };
      xhr.onerror = xhr.ontimeout = () => {
        settle();
        reject(new HttpError(0, null));
      };
      xhr.onabort = () => {
        settle();
        reject(stalled ? new HttpError(0, null) : new Interrupted());
      };
      xhr.send(data);
      arm();
    });
  }

  /** Returns whether to try again. */
  private async recover(t: Task, err: unknown): Promise<boolean> {
    if (!(err instanceof HttpError)) return this.fail(t, "Can't read this file");
    const { status, body } = err;
    t.item.sent = t.offset;
    if (status === 404) {
      this.markGone();
      return false;
    }
    if (status === 409) {
      // Offset mismatch: continue from what the server actually has.
      t.offset = t.item.sent = body?.offset ?? 0;
      return true;
    }
    if (status === 423) {
      if (++t.busy > MAX_BUSY_ATTEMPTS) return this.fail(t, err.message);
      return this.wait(t, 1000 * 2 ** t.busy);
    }
    if (status === 422) {
      this.resetHash(t);
      t.offset = t.item.sent = 0;
    } else if (status >= 400 && status < 500 && ![408, 429].includes(status)) {
      return this.fail(t, err.message);
    }
    if (++t.attempts > MAX_ATTEMPTS) return this.fail(t, err.message);
    return this.wait(t, Math.min(30_000, 500 * 2 ** t.attempts));
  }

  /** Backs off before the next try, showing the file as waiting rather than stalled. */
  private async wait(t: Task, ms: number): Promise<boolean> {
    t.item.reconnecting = true;
    this.changed();
    await this.sleep(t, Math.min(30_000, ms));
    t.item.reconnecting = false;
    return true;
  }

  private fail(t: Task, error: string) {
    t.item.status = "failed";
    t.item.error = error;
    return false;
  }

  private sleep(t: Task, ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        t.wake = undefined;
        resolve();
      };
      const timer = window.setTimeout(done, ms);
      t.wake = done;
    });
  }
}
