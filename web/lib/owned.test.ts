import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { getOwned, ownedVersion, removeOwned, saveOwned, subscribeOwned, type Owned } from "./owned";

const inHours = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
const record = (expiresAt: string): Owned => ({ token: "t", expiresAt, count: 1, size: 1, createdAt: 0 });

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    configurable: true,
  });
});

test("tells whoever is following that ownership changed", () => {
  let heard = 0;
  const stop = subscribeOwned(() => heard++);
  const before = ownedVersion();

  saveOwned("abcdefgh", record(inHours(1)));
  saveOwned("abcdefgh", record(inHours(24)));
  removeOwned("abcdefgh");
  assert.equal(heard, 3);
  assert.equal(ownedVersion(), before + 3, "and the version moves with it, for useSyncExternalStore");

  stop();
  saveOwned("abcdefgh", record(inHours(1)));
  assert.equal(heard, 3, "until they stop following");
});

test("a longer expiry replaces the old one", () => {
  saveOwned("abcdefgh", record(inHours(1)));
  const later = inHours(24 * 7);
  saveOwned("abcdefgh", { ...getOwned("abcdefgh")!, expiresAt: later });
  assert.equal(getOwned("abcdefgh")?.expiresAt, later);
});
