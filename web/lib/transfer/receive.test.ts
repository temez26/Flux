import assert from "node:assert/strict";
import { test } from "vitest";
import { createBLAKE3 } from "hash-wasm";
import type { TransferMeta } from "../api";
import type { DirectClient } from "./direct";
import { Receiver } from "./receive";
import type { Entry, FileWriter, Target } from "../save/zip";

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

const bodyOf = (idx: number) => Uint8Array.from({ length: 64 }, (_, i) => (idx * 31 + i) % 256);

async function blake3(bytes: Uint8Array) {
  const hasher = await createBLAKE3();
  hasher.init();
  hasher.update(bytes);
  return hasher.digest("hex");
}

async function transfer(count: number): Promise<TransferMeta> {
  const files = [];
  for (let idx = 0; idx < count; idx++) {
    const body = bodyOf(idx);
    files.push({
      idx,
      path: `file-${idx}.bin`,
      size: body.length,
      type: "application/octet-stream",
      modified: null,
      // Hosted: the server never sees these bytes, so it has no digest of its own either.
      hash: null,
      received: 0,
    });
  }
  return {
    code: "abcdefgh",
    title: "",
    collect: false,
    downloads: 0,
    closed: false,
    editable: false,
    noteVersion: 0,
    createdAt: "",
    expiresAt: "",
    hosted: true,
    public: false,
    lifetime: null,
    files,
  };
}

/** A sender that serves each file's bytes, and its digest, straight from memory. */
function peer(digest?: (idx: number) => Promise<string>): DirectClient {
  return {
    state: "open",
    done() {},
    async *read(idx: number, offset: number, size: number) {
      yield bodyOf(idx).slice(offset, size);
    },
    hash: (idx: number) => (digest ?? ((i: number) => blake3(bodyOf(i))))(idx),
  } as unknown as DirectClient;
}

/** Collects what was written, per file, so the result can be checked byte for byte. */
function collector() {
  const written = new Map<string, Uint8Array>();
  let finished = false;
  const target: Target = {
    async begin(entry: Entry): Promise<FileWriter> {
      const parts: Uint8Array[] = [];
      return {
        async write(chunk) {
          parts.push(Uint8Array.from(chunk));
        },
        async end() {
          const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let pos = 0;
          for (const p of parts) {
            out.set(p, pos);
            pos += p.length;
          }
          written.set(entry.path, out);
        },
      };
    },
    async finish() {
      finished = true;
    },
    abort() {},
  };
  return {
    target,
    written,
    get finished() {
      return finished;
    },
  };
}

/** Resolves when the receive ends, and gives up rather than hanging the suite if it can't. */
function settled(receiver: Receiver) {
  return new Promise<void>((resolve, reject) => {
    const give_up = setTimeout(() => reject(new Error("the receive never finished")), 5000);
    const stop = receiver.subscribe(() => {
      if (!receiver.finished) return;
      clearTimeout(give_up);
      stop();
      resolve();
    });
  });
}

test("receives every file when nothing is singled out", async () => {
  const meta = await transfer(3);
  const sink = collector();
  const receiver = new Receiver(meta, peer(), sink.target);
  receiver.start();
  await settled(receiver);

  assert.equal(receiver.error, undefined);
  assert.ok(sink.finished, "the target was closed off");
  assert.deepEqual([...sink.written.keys()].sort(), ["file-0.bin", "file-1.bin", "file-2.bin"]);
  for (const [idx, path] of ["file-0.bin", "file-1.bin", "file-2.bin"].entries()) {
    assert.deepEqual(sink.written.get(path), bodyOf(idx), path);
  }
});

test("receives only the file asked for", async () => {
  const meta = await transfer(5);
  const sink = collector();
  const receiver = new Receiver(meta, peer(), sink.target, new Set([3]));

  assert.deepEqual(
    receiver.items.map((i) => i.idx),
    [3],
    "and reports progress for that one alone",
  );
  assert.equal(receiver.snapshot.total, bodyOf(3).length, "not the weight of the whole transfer");

  receiver.start();
  await settled(receiver);
  assert.equal(receiver.error, undefined);
  assert.deepEqual([...sink.written.keys()], ["file-3.bin"]);
  assert.deepEqual(sink.written.get("file-3.bin"), bodyOf(3));
});

test("still checks the integrity of a single file", async () => {
  const meta = await transfer(2);
  const sink = collector();
  // A sender claiming a digest its own bytes don't match.
  const receiver = new Receiver(
    meta,
    peer(async () => "0".repeat(64)),
    sink.target,
    new Set([1]),
  );
  receiver.start();
  await settled(receiver);

  assert.match(receiver.error ?? "", /integrity check/);
  assert.equal(sink.written.size, 0, "nothing is handed over");
});
