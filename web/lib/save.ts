/** Destination for a download produced in the page. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): void;
}

export type SaveMethod = "stream" | "memory";

// Without a service worker the whole download is assembled in memory before saving.
const MEMORY_LIMIT = 1024 ** 3;
// Fewer, larger messages to the service worker.
const BATCH = 512 * 1024;

/** How this browser can save a download produced in the page, if at all. */
export async function saveMethod(size: number): Promise<SaveMethod | null> {
  // Safari and every iOS browser don't reliably download service-worker streams.
  const ua = navigator.userAgent;
  const webkit = /^((?!chrome|android).)*safari/i.test(ua) || /iP(hone|ad|od)/.test(ua);
  if (!webkit && "serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    if (registration?.active) return "stream";
  }
  return size <= MEMORY_LIMIT ? "memory" : null;
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
