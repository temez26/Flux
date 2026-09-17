import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { toast, toasts } from "./toast";

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  while (toasts.list.length) toasts.dismiss(toasts.list[0].id);
});
afterEach(() => vi.useRealTimers());

test("shows a message and clears it again", () => {
  toast("Code copied");
  assert.equal(toasts.list.length, 1);
  vi.advanceTimersByTime(2500);
  assert.equal(toasts.list.length, 0);
});

test("an offer stays up as long as it is worth making", () => {
  toast("Transfer deleted", "ok", { durationMs: 7000, action: { label: "Undo", run: () => {} } });
  vi.advanceTimersByTime(2500);
  assert.equal(toasts.list.length, 1, "still there once an ordinary toast would have gone");
  vi.advanceTimersByTime(4500);
  assert.equal(toasts.list.length, 0);
});

test("running the action is what the caller asked for", () => {
  let undone = false;
  toast("Transfer deleted", "ok", { action: { label: "Undo", run: () => (undone = true) } });
  toasts.list[0].action!.run();
  assert.ok(undone);
});

test("keeps only the last few, so they can't stack up forever", () => {
  for (let i = 0; i < 6; i++) toast(`message ${i}`);
  assert.deepEqual(
    toasts.list.map((t) => t.message),
    ["message 3", "message 4", "message 5"],
  );
});

test("dismissing one leaves the others", () => {
  toast("first");
  toast("second");
  toasts.dismiss(toasts.list[0].id);
  assert.deepEqual(
    toasts.list.map((t) => t.message),
    ["second"],
  );
});

test("stays up while held, and gets its whole time again once let go", () => {
  toast("Link copied");
  vi.advanceTimersByTime(2000);
  toasts.hold();
  vi.advanceTimersByTime(60_000);
  assert.equal(toasts.list.length, 1, "held for as long as it takes");
  toasts.release();
  vi.advanceTimersByTime(2000);
  assert.equal(toasts.list.length, 1, "not gone the moment it's let go");
  vi.advanceTimersByTime(500);
  assert.equal(toasts.list.length, 0);
});

test("an offer lapses when it goes untaken, and not when its action is taken", () => {
  let lapsed = 0;
  toast("Transfer deleted", "ok", { onLapse: () => lapsed++, action: { label: "Undo", run: () => {} } });
  toasts.dismiss(toasts.list[0].id);
  vi.advanceTimersByTime(10_000);
  assert.equal(lapsed, 0);

  toast("Transfer deleted", "ok", { onLapse: () => lapsed++ });
  vi.advanceTimersByTime(2500);
  assert.equal(lapsed, 1);
});

test("an offer pushed out by newer toasts has lapsed", () => {
  let lapsed = false;
  toast("Transfer deleted", "ok", { durationMs: 7000, onLapse: () => (lapsed = true) });
  for (let i = 0; i < 3; i++) toast(`message ${i}`);
  assert.ok(lapsed);
});
