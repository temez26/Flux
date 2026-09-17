import { storedByCode } from "./stored";

/**
 * Files already saved from a transfer on this device.
 *
 * A download that was interrupted can't be picked up where it stopped — the bytes went to
 * the browser, not somewhere the page can reach again — but the files that did land are
 * still on disk. Remembering which ones means reopening a transfer offers what is missing
 * rather than starting the whole thing over.
 */
export interface Saved {
  expiresAt: string;
  idxs: number[];
}

const store = storedByCode<Saved>("flux.received");

export function getReceived(code: string): ReadonlySet<number> {
  return new Set(store.read()[code]?.idxs ?? []);
}

/** Records `idxs` as saved, on top of whatever was already known for this transfer. */
export function markReceived(code: string, expiresAt: string, idxs: number[]) {
  const all = store.read();
  const merged = new Set(all[code]?.idxs ?? []);
  for (const idx of idxs) merged.add(idx);
  all[code] = { expiresAt, idxs: [...merged].sort((a, b) => a - b) };
  store.write(all);
}

export const forgetReceived = store.remove;
