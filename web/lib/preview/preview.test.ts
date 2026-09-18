import assert from "node:assert/strict";
import { test } from "vitest";
import type { Summary } from "../api";
import { summaryThumbUrl } from "./preview";

const summary = (title: string, thumb?: number | null): Summary => ({
  code: "abcd1234",
  title,
  createdAt: "",
  expiresAt: "",
  lifetime: null,
  hosted: false,
  open: false,
  downloads: 0,
  note: false,
  files: 1,
  size: 1,
  complete: true,
  thumb,
});

test("a single photo or song is listed by its thumbnail", () => {
  assert.equal(summaryThumbUrl(summary("holiday.heic", 0)), "/api/transfers/abcd1234/files/0/thumb");
  assert.equal(summaryThumbUrl(summary("Song.mp3", 3)), "/api/transfers/abcd1234/files/3/thumb");
});

test("anything the server draws no thumbnail for keeps its icon", () => {
  assert.equal(summaryThumbUrl(summary("notes.pdf", 0)), undefined);
  assert.equal(summaryThumbUrl(summary("drawing.svg", 0)), undefined, "only the browser can draw one");
  // Several files, a transfer still uploading, or an older server: no file to show.
  assert.equal(summaryThumbUrl(summary("holiday.jpg", null)), undefined);
  assert.equal(summaryThumbUrl(summary("holiday.jpg")), undefined);
  assert.equal(summaryThumbUrl(undefined), undefined);
});
