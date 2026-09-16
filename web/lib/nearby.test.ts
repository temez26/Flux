import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { defaultName } from "./device";
import { Nearby, offerTitle, type Answer, type SocketLike } from "./nearby";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** The server's side of things. */
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let sockets: FakeSocket[];
let answers: Answer[];

function nearby() {
  return new Nearby(
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    (answer) => answers.push(answer),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  answers = [];
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    configurable: true,
  });
});
afterEach(() => vi.useRealTimers());

const alice = { device: "alice", name: "Alice's Mac" };
const bob = { device: "bob", name: "Bob's iPhone" };

test("announces itself as soon as the connection opens", () => {
  const client = nearby();
  sockets[0].accept();
  assert.equal(client.connected, true);
  assert.deepEqual(sockets[0].sent, [{ device: client.device.id, name: client.device.name }]);
});

test("keeps the list of devices current", () => {
  const client = nearby();
  sockets[0].accept();
  sockets[0].push({ t: "peers", peers: [alice] });
  sockets[0].push({ t: "peer", ...bob });
  assert.deepEqual(client.peers, [alice, bob]);

  sockets[0].push({ t: "peer", device: "bob", name: "Kitchen iPad" });
  assert.deepEqual(client.peers.map((p) => p.name), ["Alice's Mac", "Kitchen iPad"], "a rename replaces, not adds");

  sockets[0].push({ t: "gone", device: "alice" });
  assert.deepEqual(client.peers.map((p) => p.device), ["bob"]);
});

test("forgets who was here when the connection drops, then reconnects and announces again", () => {
  const client = nearby();
  sockets[0].accept();
  sockets[0].push({ t: "peers", peers: [alice] });

  sockets[0].drop();
  assert.equal(client.connected, false);
  assert.deepEqual(client.peers, [], "the list could be long out of date by the time it's back");

  vi.advanceTimersByTime(500);
  assert.equal(sockets.length, 2, "tried again");
  sockets[1].accept();
  assert.equal(sockets[1].sent.length, 1, "and said who it is on the new connection");
});

test("collects offers, once per transfer, and only the latest few", () => {
  const client = nearby();
  sockets[0].accept();
  const offer = (code: string) => ({ t: "offer", from: alice, code, title: "photos", files: 3, size: 100 });

  sockets[0].push(offer("aaaaaaaa"));
  sockets[0].push(offer("aaaaaaaa"));
  assert.equal(client.offers.length, 1, "a sender tapping twice is still one offer");

  for (const code of ["b", "c", "d", "e", "f", "g"]) sockets[0].push(offer(code.repeat(8)));
  assert.equal(client.offers.length, 5);
  assert.equal(client.offers.at(-1)?.code, "gggggggg");
});

test("answering clears the offer and tells the sender", () => {
  const client = nearby();
  sockets[0].accept();
  sockets[0].push({ t: "offer", from: alice, code: "abcdefgh", title: "photos", files: 3, size: 100 });

  client.answer(client.offers[0], true);
  assert.deepEqual(client.offers, []);
  assert.deepEqual(sockets[0].sent.at(-1), { t: "answer", to: "alice", code: "abcdefgh", accepted: true });
});

test("hands an answer to whoever is waiting for one", () => {
  nearby();
  sockets[0].accept();
  sockets[0].push({ t: "answer", from: bob, code: "abcdefgh", accepted: false });
  assert.deepEqual(answers, [{ from: bob, code: "abcdefgh", accepted: false }]);
});

test("offers a transfer to one device by id", () => {
  const client = nearby();
  sockets[0].accept();
  client.offer(bob, { code: "abcdefgh", title: "notes.txt", files: 1, size: 12 });
  assert.deepEqual(sockets[0].sent.at(-1), { t: "offer", to: "bob", code: "abcdefgh", title: "notes.txt", files: 1, size: 12 });
});

test("renaming is remembered and announced", () => {
  const client = nearby();
  sockets[0].accept();
  client.rename("  Living room TV  ");
  assert.equal(client.device.name, "Living room TV");
  assert.deepEqual(sockets[0].sent.at(-1), { t: "rename", name: "Living room TV" });
  assert.equal(nearby().device.name, "Living room TV", "and still the name next time");
});

test("sends nothing while the connection isn't open", () => {
  const client = nearby();
  client.offer(bob, { code: "abcdefgh", title: "x", files: 1, size: 1 });
  assert.deepEqual(sockets[0].sent, []);
});

test("titles an offer the way the server titles a transfer", () => {
  assert.equal(offerTitle(["holiday/a.jpg", "holiday/b.jpg"]), "holiday", "a dropped folder");
  assert.equal(offerTitle(["notes.txt"]), "notes.txt", "a single file");
  assert.equal(offerTitle(["a.jpg", "b.jpg"]), "a.jpg", "loose files");
  assert.equal(offerTitle(["x/a.jpg", "y/b.jpg"]), "a.jpg", "more than one folder");
});

test("names a device after its platform, with a tag to tell two apart", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36";
  assert.equal(defaultName(iphone, "3fa9"), "iPhone 3FA");
  assert.equal(defaultName(android, "b21c"), "Android phone B21", "not Linux, though it says so too");
  assert.equal(defaultName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "000"), "Windows PC 000");
});
