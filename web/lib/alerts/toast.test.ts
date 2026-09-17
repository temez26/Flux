import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { toast, toasts } from "./toast";

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  toasts.list = [];
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
