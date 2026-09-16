import assert from "node:assert/strict";
import { test } from "vitest";
import { selectionSpec, zipUrl } from "./api";

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
