import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { contribute, contributions } from "./session";
import { Uploader } from "./upload";

interface Call {
  auth: string | null;
  body: { files: { path: string }[]; from?: string };
}

let calls: Call[];
let nextIdx: number;

beforeEach(() => {
  calls = [];
  nextIdx = 0;
  contributions.clear();
  vi.spyOn(Uploader.prototype, "start").mockImplementation(() => {});
  const store = new Map<string, string>([["flux.device", JSON.stringify({ id: "abc", name: "Bob's iPhone" })]]);
  Object.defineProperty(globalThis, "window", {
    value: Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    configurable: true,
  });
  // The server's side: indices in order, a folder per contributor, a token for a first-timer.
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body));
    calls.push({ auth: headers.get("Authorization"), body });
    const files = body.files.map((f: { path: string }) => ({ idx: nextIdx++, path: `${body.from}/${f.path}` }));
    const token = headers.get("Authorization")?.replace("Bearer ", "") ?? "issued-token";
    return new Response(JSON.stringify({ files, token }), { status: 200 });
  }) as typeof fetch;
});

const picked = (...names: string[]) => names.map((name) => ({ path: name, file: new File(["x"], name) }));

test("sends files under this device's name, with no token the first time", async () => {
  const uploader = await contribute("abcdefgh", picked("a.jpg", "b.jpg"));
  assert.equal(calls[0].auth, null);
  assert.equal(calls[0].body.from, "Bob's iPhone");
  assert.equal(uploader.token, "issued-token");
  assert.deepEqual(
    uploader.items.map((i) => i.path),
    ["Bob's iPhone/a.jpg", "Bob's iPhone/b.jpg"],
    "at the paths the server gave them",
  );
});

test("a second batch joins the first: same token, same queue", async () => {
  const first = await contribute("abcdefgh", picked("a.jpg"));
  const second = await contribute("abcdefgh", picked("c.jpg"));
  assert.equal(second, first, "one upload to follow, not two");
  assert.equal(calls[1].auth, "Bearer issued-token", "and the server is told it's the same person");
  assert.deepEqual(first.items.map((i) => i.idx), [0, 1]);
});

test("a collection that closed doesn't swallow a new batch", async () => {
  const first = await contribute("abcdefgh", picked("a.jpg"));
  first.markGone();
  const second = await contribute("abcdefgh", picked("b.jpg"));
  assert.notEqual(second, first);
  assert.equal(calls[1].auth, null, "a fresh start, rather than a token for a queue that's gone");
});
