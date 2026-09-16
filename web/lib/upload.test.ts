import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { Uploader } from "./upload";

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  });
});

/** An uploader for a transfer whose one file is already on the server, kept from sending. */
function finishedUploader() {
  const uploader = new Uploader("abcdefgh", "token", [{ idx: 0, path: "done.txt", size: 10, done: true }]);
  uploader.paused = true;
  return uploader;
}

test("files added to a finished transfer reopen its queue", () => {
  const uploader = finishedUploader();
  assert.equal(uploader.snapshot.finished, true);

  uploader.add([{ idx: 1, path: "later.txt", size: 5, file: new File(["hello"], "later.txt") }]);
  assert.deepEqual(
    uploader.items.map((i) => [i.idx, i.status]),
    [
      [0, "done"],
      [1, "pending"],
    ],
  );
  assert.equal(uploader.snapshot.total, 15, "counted toward the total");
  assert.equal(uploader.snapshot.finished, false, "and no longer finished");
});

test("a transfer that has gone takes nothing more", () => {
  const uploader = finishedUploader();
  uploader.markGone();
  uploader.add([{ idx: 1, path: "late.txt", size: 5, file: new File(["hello"], "late.txt") }]);
  assert.equal(uploader.items.length, 1);
});

test("a file removed from the server stops counting, even once uploaded", () => {
  const uploader = new Uploader("abcdefgh", "token", [
    { idx: 0, path: "keep.txt", size: 10, done: true },
    { idx: 1, path: "remove.txt", size: 5, done: true },
  ]);
  uploader.paused = true;
  assert.equal(uploader.snapshot.total, 15);

  uploader.forget(1);
  assert.equal(uploader.items[1].status, "canceled");
  (uploader as unknown as { refresh(): void }).refresh();
  assert.equal(uploader.snapshot.total, 10, "no longer part of the total");
  assert.equal(uploader.snapshot.counts.done, 1);
});
