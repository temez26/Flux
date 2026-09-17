import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeEach, test } from "vitest";
import { takeShared } from "./share";

/** Enough of the Cache API to hold responses by the paths the worker and page use. */
class FakeCache {
  entries = new Map<string, Response>();
  async put(key: string, response: Response) {
    this.entries.set(key, response);
  }
  async match(key: string) {
    return this.entries.get(key)?.clone();
  }
  async keys() {
    return [...this.entries.keys()];
  }
  async delete(key: string) {
    return this.entries.delete(key);
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

let caches: FakeCaches;

/** Runs the real sw.js and returns what it answers a request with. */
function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL("https://flux.local/"),
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    skipWaiting: async () => {},
  };
  const source = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
  vm.runInNewContext(source, { self, caches, Response, Request, URL, fetch, setTimeout, clearTimeout, console });
  return async (request: Request): Promise<Response | undefined> => {
    let answer: Promise<Response> | undefined;
    handlers.get("fetch")!({ request, respondWith: (response: Promise<Response>) => (answer = response) });
    return answer;
  };
}

function share(form: FormData) {
  return new Request("https://flux.local/share-target", { method: "POST", body: form });
}

beforeEach(() => {
  caches = new FakeCaches();
  Object.defineProperty(globalThis, "caches", { value: caches, configurable: true });
});

test("files shared from another app reach the page, named and typed as they were", async () => {
  const form = new FormData();
  form.append("files", new File(["beach"], "IMG_0042.jpg", { type: "image/jpeg" }));
  form.append("files", new File(["notes"], "Trip notes.txt", { type: "text/plain" }));

  const response = await worker()(share(form));
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("Location"), "/?shared", "and the page is sent to pick them up");

  const received = await takeShared();
  assert.deepEqual(
    received?.files.map((p) => [p.path, p.file.type]),
    [
      ["IMG_0042.jpg", "image/jpeg"],
      ["Trip notes.txt", "text/plain"],
    ],
  );
  assert.equal(await received?.files[0].file.text(), "beach");
});

test("a shared link becomes text, without saying the same link twice", async () => {
  const form = new FormData();
  form.append("title", "Flux on GitHub");
  form.append("text", "https://github.com/temez26/Flux");
  form.append("url", "https://github.com/temez26/Flux");
  await worker()(share(form));

  const received = await takeShared();
  assert.deepEqual(received?.files, []);
  assert.equal(received?.text, "Flux on GitHub\nhttps://github.com/temez26/Flux");
});

test("a share is only taken once", async () => {
  const form = new FormData();
  form.append("files", new File(["x"], "once.txt"));
  await worker()(share(form));
  assert.equal((await takeShared())?.files.length, 1);
  assert.equal(await takeShared(), null);
});

test("a new share replaces one that was never picked up", async () => {
  const send = worker();
  const first = new FormData();
  first.append("files", new File(["a"], "a.txt"));
  first.append("files", new File(["b"], "b.txt"));
  await send(share(first));
  const second = new FormData();
  second.append("files", new File(["c"], "c.txt"));
  await send(share(second));

  assert.deepEqual(
    (await takeShared())?.files.map((p) => p.path),
    ["c.txt"],
  );
});

test("a worker update keeps a share waiting to be picked up", async () => {
  await caches.open("flux-share");
  await caches.open("flux-v1");
  const handlers = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL("https://flux.local/"),
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8"), {
    self,
    caches,
    Response,
    URL,
    setTimeout,
    console,
  });
  let done: Promise<unknown> | undefined;
  handlers.get("activate")!({ waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
  assert.deepEqual(await caches.keys(), ["flux-share"], "old app caches go, the share stays");
});
