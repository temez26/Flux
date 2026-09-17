import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { SocketLike } from "../nearby/nearby";
import { NoteLive } from "./live";

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

let sockets: FakeSocket[];
let changes: number;
let viewers: number[];

function live() {
  return new NoteLive(
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    () => changes++,
    (count) => viewers.push(count),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  changes = 0;
  viewers = [];
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

test("reports changes and how many pages are open", () => {
  live();
  sockets[0].accept();
  sockets[0].push({ t: "viewers", count: 2 });
  sockets[0].push({ t: "changed" });
  assert.deepEqual(viewers, [2]);
  assert.equal(changes, 1);
});

test("counts reconnecting as a change, since changes while away went unheard", () => {
  live();
  sockets[0].accept();
  assert.equal(changes, 0, "the first connection has nothing to catch up on");

  sockets[0].close();
  assert.deepEqual(viewers, [0]);
  vi.advanceTimersByTime(500);
  assert.equal(sockets.length, 2);
  sockets[1].accept();
  assert.equal(changes, 1);
});

test("stops reconnecting once closed", () => {
  const note = live();
  sockets[0].accept();
  note.close();
  vi.advanceTimersByTime(60_000);
  assert.equal(sockets.length, 1);
  assert.deepEqual(viewers, [], "closing on purpose isn't losing the connection");
});
