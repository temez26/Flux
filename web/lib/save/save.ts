import { isAppleTouch } from "../platform/install";

/** Destination for a download produced in the page. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): void;
}

export type SaveMethod = "stream" | "memory";

// Without a service worker the whole download is assembled in memory before saving.
const MEMORY_LIMIT = 1024 ** 3;
// An iPhone or iPad closes a tab holding much less than that, and all anyone sees is the page
// reloading, so a phone is told up front instead.
const TOUCH_MEMORY_LIMIT = 512 * 1024 ** 2;
// Fewer, larger messages to the service worker.
const BATCH = 512 * 1024;
/** A wedged worker must not hold up the page that is waiting to offer a download. */
const PROBE_TIMEOUT_MS = 3000;
const PROBE = Uint8Array.of(0x46, 0x4c, 0x55, 0x58);

const timeout = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Asks the worker for a token download and reads it back.
 *
 * Holding a registration is not the same as being able to serve one: until the worker
 * controls this page its `fetch` handler never runs, which is the state every first visit
 * and every hard reload starts in. Nothing about that is visible from the page, and the
 * only symptom is a download that quietly never arrives — so spend four bytes on finding
 * out, rather than committing to a method that can't deliver.
 */
async function streamsWork(): Promise<boolean> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return false;

  const id = `probe${Date.now().toString(36)}`;
  const { port1, port2 } = new MessageChannel();
  let started: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  let sent = false;
  port1.onmessage = ({ data }) => {
    if (data === "ready") return started();
    if (data !== "pull") return;
    port1.postMessage(sent ? "end" : PROBE);
    sent = true;
  };

  try {
    worker.postMessage({ type: "flux-download", id, name: "probe.bin", size: PROBE.length }, [port2]);
    await Promise.race([ready, timeout(PROBE_TIMEOUT_MS)]);
    const response = await fetch(`/_flux/download/${id}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = new Uint8Array(await response.arrayBuffer());
    return response.ok && body.length === PROBE.length;
  } catch {
    return false;
  } finally {
    port1.close();
  }
}

/** How this browser can save a download produced in the page, if at all. */
export async function saveMethod(size: number): Promise<SaveMethod | null> {
  // WebKit reads a worker's stream back perfectly well and then declines to save it, so no
  // probe run inside the page can tell it apart from a browser that works. It is the one
  // engine that has to be named, and `vendor` names it with a single exact comparison —
  // where matching the user-agent string means excluding every Chromium browser first,
  // since they all carry "Safari" in theirs.
  const webkit = navigator.vendor === "Apple Computer, Inc.";
  if (!webkit && (await streamsWork())) return "stream";
  return size <= (isAppleTouch() ? TOUCH_MEMORY_LIMIT : MEMORY_LIMIT) ? "memory" : null;
}

/**
 * Hands a stream to the service worker, which answers a hidden download request with it.
 * The browser saves to disk as data arrives; the worker pulls one message at a time.
 */
export async function streamSink(name: string, size?: number): Promise<ByteSink> {
  const worker = (await navigator.serviceWorker.getRegistration())?.active;
  if (!worker) throw new Error("Service worker unavailable");
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const { port1, port2 } = new MessageChannel();
  let credits = 0;
  let canceled = false;
  let wake: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    port1.onmessage = ({ data }) => {
      if (data === "ready") resolve();
      else if (data === "pull") credits++;
      else if (data === "cancel") canceled = true;
      wake?.();
      wake = undefined;
    };
  });
  worker.postMessage({ type: "flux-download", id, name, size }, [port2]);
  await ready;

  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.src = `/_flux/download/${id}`;
  document.body.appendChild(frame);
  // Messages keep the worker alive while the download is paused.
  const keepAlive = window.setInterval(() => worker.postMessage({ type: "flux-keepalive" }), 10_000);
  const finish = () => {
    window.clearInterval(keepAlive);
    window.setTimeout(() => frame.remove(), 60_000);
  };

  const post = async (message: ArrayBuffer | "end") => {
    while (!credits && !canceled) await new Promise<void>((resolve) => (wake = resolve));
    if (canceled) throw new Error("The download was canceled in the browser");
    credits--;
    if (message === "end") port1.postMessage(message);
    else port1.postMessage(message, [message]);
  };

  let batch: Uint8Array[] = [];
  let batched = 0;
  const flush = async () => {
    if (!batched) return;
    const out = new Uint8Array(batched);
    let pos = 0;
    for (const part of batch) {
      out.set(part, pos);
      pos += part.length;
    }
    batch = [];
    batched = 0;
    await post(out.buffer);
  };

  return {
    async write(chunk) {
      batch.push(chunk);
      batched += chunk.length;
      if (batched >= BATCH) await flush();
    },
    async close() {
      await flush();
      await post("end");
      finish();
    },
    abort() {
      port1.postMessage("abort");
      finish();
    },
  };
}

/** Collects everything in memory and saves it at the end. */
export function memorySink(name: string): ByteSink {
  let parts: BlobPart[] = [];
  return {
    async write(chunk) {
      parts.push(chunk as Uint8Array<ArrayBuffer>);
    },
    async close() {
      const url = URL.createObjectURL(new Blob(parts));
      parts = [];
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    abort() {
      parts = [];
    },
  };
}
