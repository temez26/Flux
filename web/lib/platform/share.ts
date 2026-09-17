import { fromFileList, type Picked } from "./files";

/** Where the service worker parks what another app shares; sw.js uses the same names. */
const SHARE_CACHE = "flux-share";
const SHARED = "/_flux/shared/";

export interface Shared {
  files: Picked[];
  text: string;
}

/**
 * Takes what another app shared to Flux, if anything is waiting, and clears it so it is only
 * taken once. The service worker receives the share and the page loads after it has answered,
 * so a cache is the one place both can reach.
 */
export async function takeShared(): Promise<Shared | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE);
  const meta = await cache.match(`${SHARED}meta`);
  if (!meta) return null;
  const { files: count, text } = (await meta.json()) as { files: number; text: string };

  const files: File[] = [];
  for (let i = 0; i < count; i++) {
    const stored = await cache.match(`${SHARED}${i}`);
    if (!stored) continue;
    const name = decodeURIComponent(stored.headers.get("X-Name") ?? "") || "Shared file";
    // A form post carries no modification times, so a shared file has none worth keeping.
    files.push(new File([await stored.blob()], name, { type: stored.headers.get("Content-Type") ?? "" }));
  }
  for (const key of await cache.keys()) await cache.delete(key);
  return { files: fromFileList(files), text };
}

/** What a share gathers is held in memory first, so stay well inside what a phone's tab survives. */
export const SHARE_LIMIT = 256 * 1024 ** 2;

/**
 * Whether this device's Share sheet takes files with these names. It is how a phone puts a
 * photo in its library, which a download never reaches: iOS files every download under Files.
 * Chrome takes only some kinds of file, and tells them apart by name, so empty stand-ins
 * answer before anything is fetched.
 */
export function canShareFiles(names: string[]): boolean {
  if (typeof navigator.canShare !== "function" || !window.matchMedia("(pointer: coarse)").matches) return false;
  try {
    return navigator.canShare({ files: names.map((name) => new File([], name)) });
  } catch {
    return false;
  }
}
