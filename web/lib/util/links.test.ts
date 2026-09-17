import assert from "node:assert/strict";
import { test } from "vitest";
import { linkify } from "./links";

test("finds web addresses in text", () => {
  assert.deepEqual(linkify("Recipe: https://example.com/soup?serves=4 — try it"), [
    "Recipe: ",
    { url: "https://example.com/soup?serves=4" },
    " — try it",
  ]);
});

test("leaves a sentence's punctuation out of the link", () => {
  assert.deepEqual(linkify("See https://example.com/a."), ["See ", { url: "https://example.com/a" }, "."]);
  assert.deepEqual(linkify("(https://example.com/b)"), ["(", { url: "https://example.com/b" }, ")"]);
});

test("text with no link is one piece, and empty text none", () => {
  assert.deepEqual(linkify("password: hunter2"), ["password: hunter2"]);
  assert.deepEqual(linkify(""), []);
});

test("only plain web addresses count", () => {
  assert.deepEqual(linkify("ftp://x and javascript:alert(1) and example.com"), ["ftp://x and javascript:alert(1) and example.com"]);
});

test("several links on several lines", () => {
  assert.deepEqual(linkify("a http://one.local\nb https://two.local"), ["a ", { url: "http://one.local" }, "\nb ", { url: "https://two.local" }]);
});
