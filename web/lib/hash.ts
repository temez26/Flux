import { createBLAKE3, createCRC32, type IHasher } from "hash-wasm";
import type { HashReply, HashRequest } from "./hash.worker";

// hash-wasm instantiates WebAssembly behind a global lock on every create, which throttles
// runs of small files; finished hashers are reset and reused instead.
const pools = { blake3: [] as IHasher[], crc32: [] as IHasher[] };
const factories = { blake3: () => createBLAKE3(), crc32: () => createCRC32() };

export type HashKind = keyof typeof pools;

export async function acquireHasher(kind: HashKind): Promise<IHasher> {
  return pools[kind].pop()?.init() ?? factories[kind]();
}

export function releaseHasher(kind: HashKind, hasher: IHasher) {
  pools[kind].push(hasher);
}

/**
 * A BLAKE3 digest built from a file's bytes in order.
 *
 * `update` takes ownership of `data` and hands the same bytes back, because off the main
 * thread they reach the hasher by being moved rather than copied. Always keep what it
 * returns: the array passed in is left detached.
 */
export interface Hasher {
  update(data: Uint8Array<ArrayBuffer>, from?: number): Promise<Uint8Array<ArrayBuffer>>;
  digest(): Promise<string>;
  release(): void;
}

// Hashing a chunk is a single long run of wasm. On the main thread it blocks everything the
// page wants to do — rendering above all — for as long as it takes, so it belongs in a
// worker, with the chunk moved across instead of copied.
let worker: Worker | null | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (reply: HashReply) => void; reject: (err: Error) => void }>();

function failAll(message: string) {
  for (const { reject } of pending.values()) reject(new Error(message));
  pending.clear();
}

function hashWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<HashReply>) => {
      const reply = event.data;
      const waiter = pending.get(reply.seq);
      pending.delete(reply.seq);
      if (!waiter) return;
      if ("error" in reply) waiter.reject(new Error(reply.error));
      else waiter.resolve(reply);
    };
    // A worker that dies takes its half-built digests with it, so every file it was hashing
    // has to start over; new ones fall back to hashing here.
    worker.onerror = () => {
      worker = null;
      failAll("Hashing stopped unexpectedly");
    };
  } catch {
    worker = null;
  }
  return worker;
}

function ask(req: HashRequest, transfer: Transferable[] = []): Promise<HashReply> {
  const active = hashWorker();
  if (!active) return Promise.reject(new Error("No hashing worker"));
  return new Promise((resolve, reject) => {
    pending.set(req.seq, { resolve, reject });
    active.postMessage(req, transfer);
  });
}

function workerHasher(id: number): Hasher {
  return {
    async update(data, from = 0) {
      const reply = await ask(
        { op: "update", id, seq: sequence++, buffer: data.buffer, offset: data.byteOffset + from, length: data.byteLength - from },
        [data.buffer],
      );
      if (!("buffer" in reply)) throw new Error("Hashing failed");
      return new Uint8Array(reply.buffer, data.byteOffset, data.byteLength);
    },
    async digest() {
      const reply = await ask({ op: "digest", id, seq: sequence++ });
      if (!("hash" in reply)) throw new Error("Hashing failed");
      return reply.hash;
    },
    release() {
      void ask({ op: "release", id, seq: sequence++ }).catch(() => {});
    },
  };
}

// Without a worker the wasm call still has to happen here, so it is fed in slices this size
// to keep any single block short enough not to lose a frame.
const SLICE = 1 << 20;

// The pause between slices has to be a real task — a microtask runs before the browser ever
// renders — but not a timer, whose clamping would throttle hashing to a crawl.
const waiting: (() => void)[] = [];
const channel = typeof MessageChannel === "function" ? new MessageChannel() : undefined;
if (channel) channel.port1.onmessage = () => waiting.shift()?.();

function yieldToBrowser(): Promise<void> {
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}

function localHasher(): Hasher {
  let hasher: IHasher | undefined;
  return {
    async update(data, from = 0) {
      hasher ??= await acquireHasher("blake3");
      for (let offset = from; offset < data.length; offset += SLICE) {
        hasher.update(data.subarray(offset, Math.min(offset + SLICE, data.length)));
        if (offset + SLICE < data.length) await yieldToBrowser();
      }
      return data;
    },
    async digest() {
      hasher ??= await acquireHasher("blake3");
      const hash = hasher.digest("hex");
      releaseHasher("blake3", hasher);
      hasher = undefined;
      return hash;
    },
    release() {
      if (hasher) releaseHasher("blake3", hasher);
      hasher = undefined;
    },
  };
}

let nextId = 0;

export function createHasher(): Hasher {
  return hashWorker() ? workerHasher(nextId++) : localHasher();
}
