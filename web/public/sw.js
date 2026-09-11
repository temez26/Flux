// App-shell caching for instant, offline-capable startup (the API is never cached), plus
// streamed downloads of files the page receives directly from another device.
const CACHE = "flux-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];
const NAVIGATION_TIMEOUT_MS = 4000;
const DOWNLOAD_PREFIX = "/_flux/download/";

/** Streams registered by pages, awaiting the download request that picks them up. */
const downloads = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const { data } = event;
  if (data?.type !== "flux-download") return; // keepalive pings need no handling
  const port = event.ports[0];
  downloads.set(data.id, { port, name: data.name, size: data.size });
  port.postMessage("ready");
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith(DOWNLOAD_PREFIX)) event.respondWith(download(url.pathname.slice(DOWNLOAD_PREFIX.length)));
  else if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
  else if (request.mode === "navigate") event.respondWith(shell(request));
  else event.respondWith(networkFirst(request));
});

// The page posts one message per pull, so the browser's download speed paces the transfer.
function download(id) {
  const entry = downloads.get(id);
  if (!entry) return new Response("Download expired", { status: 404 });
  downloads.delete(id);
  const { port, name, size } = entry;
  let controller;
  let pulled;
  port.onmessage = ({ data }) => {
    try {
      if (data === "end") controller.close();
      else if (data === "abort") controller.error(new Error("Download aborted"));
      else controller.enqueue(new Uint8Array(data));
    } catch {
      // The stream was already closed or canceled.
    }
    pulled?.();
    pulled = undefined;
  };
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      return new Promise((resolve) => {
        pulled = resolve;
        port.postMessage("pull");
      });
    },
    cancel() {
      port.postMessage("cancel");
    },
  });
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
    "X-Content-Type-Options": "nosniff",
  };
  if (size !== undefined) headers["Content-Length"] = String(size);
  return new Response(stream, { headers });
}

// Every route renders the same single-page shell, so one cached copy serves all navigations.
async function shell(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (response.ok) await cache.put("/", response.clone());
    return response;
  } catch {
    return (await cache.match("/")) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
