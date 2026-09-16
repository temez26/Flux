import assert from "node:assert/strict";
import { test } from "vitest";
import { fromClipboard } from "./files";

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
