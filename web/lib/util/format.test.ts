import assert from "node:assert/strict";
import { test } from "vitest";
import { formatLifetime } from "./format";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test("reports the server's expiry for an uploaded transfer", () => {
  assert.equal(formatLifetime(inDays(7), false, false), "Expires in 7 days");
  assert.equal(formatLifetime(inDays(-1), false, false), "Expired");
});

test("a transfer served from this device lasts as long as the tab", () => {
  // The code is reserved on the server for days, but that is not what the sender is asking.
  assert.equal(formatLifetime(inDays(7), true, true), "While this page is open");
});

test("and says so plainly once the tab has gone", () => {
  assert.equal(
    formatLifetime(inDays(7), true, false),
    "Ended when the page closed",
    "rather than promising a week for something already over",
  );
});

test("an upload still under way counts its lifetime from when it completes", () => {
  // The server keeps it for a day while it uploads; that is not how long it will last.
  assert.equal(formatLifetime(inDays(1), false, true, Date.now(), 300), "Expires 5 minutes after upload");
  assert.equal(formatLifetime(inDays(1), false, true, Date.now(), 86_400), "Expires 1 day after upload");
});
