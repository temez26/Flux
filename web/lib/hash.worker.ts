/// <reference lib="webworker" />

import { createBLAKE3, type IHasher } from "hash-wasm";

export type HashRequest =
  | { op: "update"; id: number; seq: number; buffer: ArrayBuffer; offset: number; length: number }
  | { op: "digest"; id: number; seq: number }
  | { op: "release"; id: number; seq: number };

export type HashReply = { seq: number; hash: string } | { seq: number; done: true } | { seq: number; error: string };

const hashers = new Map<number, IHasher>();

async function hasherFor(id: number): Promise<IHasher> {
  let hasher = hashers.get(id);
  if (!hasher) {
    hasher = await createBLAKE3();
    hashers.set(id, hasher);
  }
  return hasher;
}

async function handle(req: HashRequest): Promise<HashReply> {
  if (req.op === "release") {
    hashers.delete(req.id);
    return { seq: req.seq, done: true };
  }
  const hasher = await hasherFor(req.id);
  if (req.op === "digest") {
    hashers.delete(req.id);
    return { seq: req.seq, hash: hasher.digest("hex") };
  }
  hasher.update(new Uint8Array(req.buffer, req.offset, req.length));
  return { seq: req.seq, done: true };
}

// A streaming hash only means anything if its chunks arrive in order, so requests are run
// one at a time rather than raced by the `await` inside `hasherFor`.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<HashRequest>) => {
  const req = event.data;
  queue = queue.then(async () => {
    try {
      self.postMessage(await handle(req));
    } catch (err) {
      self.postMessage({ seq: req.seq, error: err instanceof Error ? err.message : "Hashing failed" } satisfies HashReply);
    }
  });
};
