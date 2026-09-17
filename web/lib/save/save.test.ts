import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { saveMethod } from "./save";

const GIB = 1024 ** 3;
const DOWNLOAD_PREFIX = "/_flux/download/";

interface Options {
  vendor?: string;
  /** Above zero on an iPhone or iPad; a Mac has none. */
  maxTouchPoints?: number;
  /** No controller means the worker isn't driving this page's requests yet. */
  controlled?: boolean;
  /** The worker takes the registration but never answers the handshake. */
  mute?: boolean;
  /** The request for the registered download misses, as it does once it has expired. */
  missing?: boolean;
  /** The worker answers, but the stream it hands back carries nothing. */
  truncated?: boolean;
}

const originals = { navigator: globalThis.navigator, fetch: globalThis.fetch, window: globalThis.window };

/**
 * A stand-in for sw.js: it takes a download over a port, then answers the matching request
 * by pulling from that port, which is the handshake the probe has to survive.
 */
function install({
  vendor = "Google Inc.",
  maxTouchPoints = 0,
  controlled = true,
  mute = false,
  missing = false,
  truncated = false,
}: Options) {
  const pending = new Map<string, MessagePort>();

  const controller = {
    postMessage(message: { type: string; id: string }, transfer: MessagePort[]) {
      if (message.type !== "flux-download" || mute) return;
      const port = transfer[0];
      pending.set(message.id, port);
      port.postMessage("ready");
    },
  };

  const fetched = async (input: string) => {
    const port = pending.get(input.slice(DOWNLOAD_PREFIX.length));
    if (!port || missing) return new Response("Download expired", { status: 404 });
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve) => {
      port.onmessage = ({ data }) => {
        if (data === "end" || data === "abort") return resolve();
        chunks.push(new Uint8Array(data));
        port.postMessage("pull");
      };
      port.postMessage("pull");
    });
    // Sized up front so the body is backed by a plain ArrayBuffer, which is what a Response takes.
    const length = truncated ? 0 : chunks.reduce((n, c) => n + c.length, 0);
    const body = new Uint8Array(length);
    let pos = 0;
    if (!truncated) {
      for (const chunk of chunks) {
        body.set(chunk, pos);
        pos += chunk.length;
      }
    }
    return new Response(body);
  };

  Object.defineProperty(globalThis, "navigator", {
    value: { vendor, maxTouchPoints, serviceWorker: { controller: controlled ? controller : null } },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  globalThis.fetch = ((input: string) => fetched(input)) as typeof fetch;
}

afterEach(() => {
  for (const [key, value] of Object.entries(originals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

test("streams when the worker is controlling the page and answers", async () => {
  install({});
  assert.equal(await saveMethod(10 * GIB), "stream", "size is no object once it streams");
});

test("falls back to memory before the worker controls the page", async () => {
  // Holding a registration isn't enough, and this is the state every hard reload starts in.
  install({ controlled: false });
  assert.equal(await saveMethod(1), "memory");
});

test("falls back when the registered download can't be found", async () => {
  install({ missing: true });
  assert.equal(await saveMethod(1), "memory");
});

test("falls back when the worker answers with nothing", async () => {
  // A 200 that carries no bytes would save an empty file, which is worse than not offering.
  install({ truncated: true });
  assert.equal(await saveMethod(1), "memory");
});

test("falls back rather than hanging on a worker that never answers", async () => {
  install({ mute: true });
  const started = Date.now();
  assert.equal(await saveMethod(1), "memory");
  assert.ok(Date.now() - started < 10_000, "gave up on its own");
});

test("never streams on WebKit, which reads the stream and then won't save it", async () => {
  install({ vendor: "Apple Computer, Inc." });
  assert.equal(await saveMethod(1), "memory");
});

test("refuses a transfer too big to hold in memory when it can't stream", async () => {
  install({ controlled: false });
  assert.equal(await saveMethod(GIB), "memory", "right at the limit");
  assert.equal(await saveMethod(GIB + 1), null, "and past it there is nowhere to put it");
});

test("holds far less in memory on an iPhone or iPad, which closes a tab that takes too much", async () => {
  install({ vendor: "Apple Computer, Inc.", maxTouchPoints: 5 });
  assert.equal(await saveMethod(512 * 1024 ** 2), "memory");
  assert.equal(await saveMethod(512 * 1024 ** 2 + 1), null);
  install({ vendor: "Apple Computer, Inc." });
  assert.equal(await saveMethod(GIB), "memory", "a Mac keeps the usual limit");
});
