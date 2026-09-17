import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { notificationsOn, notify, turnOffNotifications, turnOnNotifications } from "./notify";

interface Shown {
  title: string;
  options: NotificationOptions;
  via: "worker" | "page";
}

let shown: Shown[];
let permission: NotificationPermission;
let visibility: DocumentVisibilityState;
let worker: boolean;

beforeEach(() => {
  shown = [];
  permission = "default";
  visibility = "hidden";
  worker = true;
  const store = new Map<string, string>();

  class FakeNotification {
    onclick: (() => void) | null = null;
    static get permission() {
      return permission;
    }
    static async requestPermission() {
      return (permission = "granted");
    }
    constructor(title: string, options: NotificationOptions) {
      shown.push({ title, options, via: "page" });
    }
  }

  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true });
  define("Notification", FakeNotification);
  define("window", Object.assign(globalThis, { isSecureContext: true }));
  define("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  define("document", {
    get visibilityState() {
      return visibility;
    },
  });
  define("navigator", {
    serviceWorker: {
      getRegistration: async () =>
        worker ? { showNotification: async (title: string, options: NotificationOptions) => void shown.push({ title, options, via: "worker" }) } : undefined,
    },
  });
});

test("stays quiet until turned on", async () => {
  await notify("Upload finished");
  assert.equal(shown.length, 0);
});

test("asks for permission when turned on, and then notifies", async () => {
  assert.equal(await turnOnNotifications(), true);
  assert.equal(notificationsOn(), true);
  await notify("Upload finished", "abcd-efgh is ready", "upload-abcd");
  assert.deepEqual(shown, [{ title: "Upload finished", options: { body: "abcd-efgh is ready", tag: "upload-abcd", icon: "/icons/icon-192.png" }, via: "worker" }]);
});

test("says nothing to a page that is being looked at", async () => {
  await turnOnNotifications();
  visibility = "visible";
  await notify("Upload finished");
  assert.equal(shown.length, 0, "the page already shows it");
});

test("goes through the service worker where there is one, since Android allows nothing else", async () => {
  await turnOnNotifications();
  await notify("via worker");
  worker = false;
  await notify("via page");
  assert.deepEqual(
    shown.map((s) => s.via),
    ["worker", "page"],
  );
});

test("reports a refusal rather than pretending", async () => {
  Object.defineProperty(globalThis.Notification, "requestPermission", { value: async () => (permission = "denied"), configurable: true });
  assert.equal(await turnOnNotifications(), false);
  await notify("anything");
  assert.equal(shown.length, 0);
});

test("can be turned off again without giving up the permission", async () => {
  await turnOnNotifications();
  turnOffNotifications();
  assert.equal(notificationsOn(), false);
  await notify("anything");
  assert.equal(shown.length, 0);
});

test("offers nothing where the page isn't a secure context", async () => {
  Object.defineProperty(globalThis, "window", { value: Object.assign(globalThis, { isSecureContext: false }), configurable: true });
  assert.equal(await turnOnNotifications(), false);
});
