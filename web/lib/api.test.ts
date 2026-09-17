import assert from "node:assert/strict";
import { test } from "vitest";
import { saveNote, selectionSpec, zipUrl } from "./api";

test("writes runs of files as ranges", () => {
  assert.equal(selectionSpec([0, 1, 2, 3, 7, 9, 10]), "0-3,7,9-10");
  assert.equal(selectionSpec([5]), "5");
});

test("doesn't depend on the order or repeats it is given", () => {
  assert.equal(selectionSpec([10, 9, 0, 3, 2, 1, 7, 3]), "0-3,7,9-10");
});

test("keeps a whole folder to a few characters however many files it holds", () => {
  const folder = Array.from({ length: 5000 }, (_, i) => i + 1200);
  assert.equal(selectionSpec(folder), "1200-6199");
});

test("points a zip at the whole transfer or just a selection", () => {
  assert.equal(zipUrl("abcdefgh"), "/api/transfers/abcdefgh/zip");
  assert.equal(zipUrl("abcdefgh", [4, 2, 3]), "/api/transfers/abcdefgh/zip?files=2-4");
});

test("a save someone else beat comes back as a conflict, with their text", async () => {
  const replies: [number, object][] = [
    [200, { text: "mine", version: 3 }],
    [409, { text: "theirs", version: 4 }],
    [403, { error: "this text is read-only" }],
  ];
  const sent: { url: string; auth: string | null; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, auth: new Headers(init.headers).get("Authorization"), body: JSON.parse(String(init.body)) });
    const [status, body] = replies.shift()!;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

  assert.deepEqual(await saveNote("abcdefgh", "owner-token", "mine", 2), { saved: { text: "mine", version: 3 } });
  assert.deepEqual(sent[0], {
    url: "/api/transfers/abcdefgh/note",
    auth: "Bearer owner-token",
    body: { text: "mine", version: 2 },
  });

  assert.deepEqual(await saveNote("abcdefgh", undefined, "mine", 3), { conflict: { text: "theirs", version: 4 } });
  assert.equal(sent[1].auth, null, "someone without the owner's token sends none");

  await assert.rejects(saveNote("abcdefgh", undefined, "mine", 4), /read-only/);
});
