/** The event Chromium browsers send once the page qualifies to be installed as an app. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offered: InstallPrompt | null = null;
const listeners = new Set<() => void>();

function set(prompt: InstallPrompt | null) {
  offered = prompt;
  for (const listener of listeners) listener();
}

/**
 * Keeps the browser's offer to install Flux, which it makes once and only to a listener
 * already in place. The browser's own prompt is left alone.
 */
export function watchInstall() {
  window.addEventListener("beforeinstallprompt", (e) => set(e as InstallPrompt));
  window.addEventListener("appinstalled", () => set(null));
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const canInstall = () => offered !== null;

/** Shows the browser's install dialog; true when Flux was installed. */
export async function install(): Promise<boolean> {
  if (!offered) return false;
  const prompt = offered;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  // An offer can only be shown once, whatever the answer.
  set(null);
  return outcome === "accepted";
}

/** Running as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * An iPhone or iPad, where installing is Add to Home Screen in the Share menu, with no prompt
 * a page can show. Every browser there is WebKit, and only touch tells it apart from a Mac.
 */
export const isAppleTouch = () => navigator.vendor === "Apple Computer, Inc." && navigator.maxTouchPoints > 0;
