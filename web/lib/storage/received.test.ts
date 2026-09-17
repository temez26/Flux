import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { forgetReceived, getReceived, markReceived } from "./received";

const hour = () => new Date(Date.now() + 3600_000).toISOString();
const ago = () => new Date(Date.now() - 1000).toISOString();

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    configurable: true,
  });
});

test("remembers nothing until something is saved", () => {
  assert.equal(getReceived("abcdefgh").size, 0);
});

test("accumulates files across separate downloads", () => {
  markReceived("abcdefgh", hour(), [3]);
  markReceived("abcdefgh", hour(), [7, 3]);
  assert.deepEqual(
    [...getReceived("abcdefgh")].sort((a, b) => a - b),
    [3, 7],
    "no duplicates",
  );
});

test("keeps transfers apart", () => {
  markReceived("aaaaaaaa", hour(), [1]);
  markReceived("bbbbbbbb", hour(), [2]);
  assert.deepEqual([...getReceived("aaaaaaaa")], [1]);
  assert.deepEqual([...getReceived("bbbbbbbb")], [2]);
});

test("forgets a transfer once it has expired", () => {
  markReceived("expired0", ago(), [1, 2]);
  assert.equal(getReceived("expired0").size, 0, "the transfer is gone, so is what it saved");
});

test("forgets on request, e.g. when the transfer is deleted", () => {
  markReceived("abcdefgh", hour(), [1]);
  forgetReceived("abcdefgh");
  assert.equal(getReceived("abcdefgh").size, 0);
});

test("survives storage that refuses to co-operate", () => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    },
    configurable: true,
  });
  assert.equal(getReceived("abcdefgh").size, 0);
  markReceived("abcdefgh", hour(), [1]);
  assert.equal(getReceived("abcdefgh").size, 0, "and reports nothing rather than throwing");
});
