import assert from "node:assert/strict";
import { test } from "vitest";
import type { TransferMeta } from "./api";
import type { Picked } from "./files";
import { matchPicked } from "./session";

function transfer(files: { path: string; size: number; hash?: string }[]): TransferMeta {
  return {
    code: "abcdefgh",
    title: "",
    collect: false,
    downloads: 0,
    closed: false,
    createdAt: "",
    expiresAt: "",
    hosted: false,
    files: files.map((f, idx) => ({
      idx,
      path: f.path,
      size: f.size,
      type: "",
      modified: null,
      hash: f.hash ?? null,
      received: 0,
    })),
  };
}

const pick = (path: string, size: number): Picked => ({ path, file: { size } as File });

test("lines files up by their path", () => {
  const meta = transfer([{ path: "trip/a.jpg", size: 10 }, { path: "trip/b.jpg", size: 20 }]);
  const match = matchPicked(meta, [pick("trip/a.jpg", 10), pick("trip/b.jpg", 20)]);

  assert.equal(match.matched, 2);
  assert.deepEqual(match.missing, []);
  assert.ok(match.entries.every((e) => e.file), "every entry carries its file");
});

test("falls back to name and size when the folder was renamed", () => {
  // Dropping the same folder in under a different name is an ordinary thing to do.
  const meta = transfer([{ path: "trip/a.jpg", size: 10 }]);
  const match = matchPicked(meta, [pick("holiday/a.jpg", 10)]);

  assert.equal(match.matched, 1, "matched despite the path differing");
  assert.deepEqual(match.missing, []);
});

test("a same-named file of a different size is not the same file", () => {
  const meta = transfer([{ path: "a.jpg", size: 10 }]);
  const match = matchPicked(meta, [pick("a.jpg", 999)]);

  assert.equal(match.matched, 0);
  assert.deepEqual(match.missing, ["a.jpg"]);
});

test("names what a partial selection left out", () => {
  const meta = transfer([
    { path: "a.jpg", size: 1 },
    { path: "b.jpg", size: 2 },
    { path: "c.jpg", size: 3 },
  ]);
  const match = matchPicked(meta, [pick("b.jpg", 2)]);

  assert.equal(match.matched, 1);
  assert.deepEqual(match.missing, ["a.jpg", "c.jpg"], "so the sender can be told which");
});

test("files the server already holds need nothing picked", () => {
  const meta = transfer([
    { path: "done.jpg", size: 1, hash: "ab".repeat(32) },
    { path: "todo.jpg", size: 2 },
  ]);
  const match = matchPicked(meta, [pick("todo.jpg", 2)]);

  assert.equal(match.complete, 1);
  assert.equal(match.matched, 1);
  assert.deepEqual(match.missing, [], "an uploaded file is not missing");
  assert.equal(match.entries[0].done, true);
  assert.equal(match.entries[0].file, undefined, "and is never re-read from disk");
});

test("reports a selection that matched nothing at all", () => {
  const meta = transfer([{ path: "a.jpg", size: 1 }, { path: "b.jpg", size: 2 }]);
  const match = matchPicked(meta, [pick("unrelated.txt", 500)]);

  assert.equal(match.matched, 0, "which is what stops an upload of nothing but failures");
  assert.deepEqual(match.missing, ["a.jpg", "b.jpg"]);
});
