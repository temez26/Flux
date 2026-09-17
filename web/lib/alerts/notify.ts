/**
 * System notifications for what happens while Flux isn't the page being looked at: an offer
 * from a nearby device, an upload finishing, someone starting to download. A visible page
 * already shows all of it, so nothing is sent then.
 */
const KEY = "flux.notify";
const ICON = "/icons/icon-192.png";

/** Browsers only allow notifications from a secure context, and iOS only from an installed app. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window;
}

export function notificationsOn(): boolean {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function remember(value: "on" | "off") {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Private mode: the choice lasts as long as the permission does.
  }
}

/** Asks for permission where it hasn't been given; true when notifications will now be sent. */
export async function turnOnNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const permission =
    Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return false;
  remember("on");
  return true;
}

export function turnOffNotifications() {
  remember("off");
}

/** `tag` replaces an earlier notification about the same thing rather than stacking another. */
export async function notify(title: string, body?: string, tag?: string) {
  if (document.visibilityState === "visible" || !notificationsOn()) return;
  const options: NotificationOptions = { body, tag, icon: ICON };
  try {
    // Android refuses the Notification constructor outright; only a service worker may show one.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) return await registration.showNotification(title, options);
    new Notification(title, options).onclick = () => window.focus();
  } catch {
    // A notification that can't be shown isn't worth an error on top.
  }
}
