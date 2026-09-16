import assert from "node:assert/strict";
import { test } from "vitest";
import { fromText } from "./files";

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
