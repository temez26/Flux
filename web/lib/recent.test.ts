import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { clearRecent, forgetRecent, listRecent, recentVersion, rememberRecent, subscribeRecent } from "./recent";

const inHours = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
const transfer = (title: string, expiresAt = inHours(24)) => ({ title, files: 1, size: 10, expiresAt });

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    configurable: true,
  });
});

test("lists what was opened, most recent first", () => {
  rememberRecent("aaaaaaaa", transfer("first"), 1);
  rememberRecent("bbbbbbbb", transfer("second"), 2);
  assert.deepEqual(listRecent().map(([code]) => code), ["bbbbbbbb", "aaaaaaaa"]);
});

test("opening one again moves it to the top rather than listing it twice", () => {
  rememberRecent("aaaaaaaa", transfer("photos"), 1);
  rememberRecent("bbbbbbbb", transfer("notes"), 2);
  rememberRecent("aaaaaaaa", transfer("photos, now with more"), 3);
  assert.deepEqual(
    listRecent().map(([code, r]) => [code, r.title]),
    [
      ["aaaaaaaa", "photos, now with more"],
      ["bbbbbbbb", "notes"],
    ],
  );
});

test("keeps only the latest twenty", () => {
  for (let i = 0; i < 25; i++) rememberRecent(`code${String(i).padStart(4, "0")}`, transfer(`t${i}`), i);
  const listed = listRecent();
  assert.equal(listed.length, 20);
  assert.equal(listed[0][1].title, "t24");
  assert.equal(listed.at(-1)?.[1].title, "t5", "the oldest fall off");
});

test("forgets a transfer once it has expired", () => {
  rememberRecent("gone0000", transfer("expired", inHours(-1)), 1);
  rememberRecent("here0000", transfer("current"), 2);
  assert.deepEqual(listRecent().map(([code]) => code), ["here0000"]);
});

test("forgets one, or all of them, and says so to whoever follows", () => {
  let heard = 0;
  const stop = subscribeRecent(() => heard++);
  const before = recentVersion();
  rememberRecent("aaaaaaaa", transfer("a"), 1);
  rememberRecent("bbbbbbbb", transfer("b"), 2);
  forgetRecent("aaaaaaaa");
  assert.deepEqual(listRecent().map(([code]) => code), ["bbbbbbbb"]);
  clearRecent();
  assert.deepEqual(listRecent(), []);
  assert.equal(heard, 4);
  assert.equal(recentVersion(), before + 4);
  stop();
});
