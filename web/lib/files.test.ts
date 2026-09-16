import assert from "node:assert/strict";
import { test } from "vitest";
import { fromClipboard, fromText } from "./files";

test("names text after its first line", async () => {
  const [picked] = fromText("Wifi password\nhunter2");
  assert.equal(picked.path, "Wifi password.txt");
  assert.equal(picked.file.type, "text/plain");
  assert.equal(await picked.file.text(), "Wifi password\nhunter2", "the whole text, untouched");
});

test("keeps a name short, and free of what a filesystem or the server would refuse", () => {
  assert.equal(fromText("https://example.com/a?b=c")[0].path, "httpsexample.comab=c.txt", "no path separators");
  assert.equal(fromText("x".repeat(100))[0].path, `${"x".repeat(40)}.txt`);
  assert.equal(fromText("  \n\n  indented\n")[0].path, "indented.txt", "leading blank lines don't name it");
});

test("falls back to a plain name when the first line gives nothing to go on", () => {
  assert.equal(fromText("???")[0].path, "Text.txt");
  assert.equal(fromText("   ")[0].path, "Text.txt");
});

test("treats Windows line endings like any other", () => {
  assert.equal(fromText("Shopping list\r\nmilk")[0].path, "Shopping list.txt");
});

test("names a pasted screenshot for when it was pasted", () => {
  const when = new Date(2026, 8, 17, 14, 3, 7);
  const [pasted] = fromClipboard([new File(["x"], "image.png", { type: "image/png" })], when);
  assert.equal(pasted.path, "Pasted image 2026-09-17 at 14.03.07.png");
});

test("tells several pasted screenshots apart, and leaves a real file name alone", () => {
  const when = new Date(2026, 8, 17, 14, 3, 7);
  const paths = fromClipboard(
    [new File(["a"], "image.png"), new File(["b"], "image.png"), new File(["c"], "report.pdf")],
    when,
  ).map((p) => p.path);
  assert.deepEqual(paths, ["Pasted image 2026-09-17 at 14.03.07 (1).png", "Pasted image 2026-09-17 at 14.03.07.png", "report.pdf"]);
});
