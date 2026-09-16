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

const KEY = "flux.received";

function read(): Record<string, Saved> {
  try {
    const all: Record<string, Saved> = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const now = Date.now();
    for (const [code, saved] of Object.entries(all)) {
      if (!(Date.parse(saved.expiresAt) > now)) delete all[code];
    }
    return all;
  } catch {
    return {};
  }
}

function write(all: Record<string, Saved>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable (private mode); this tab then remembers nothing.
  }
}

export function getReceived(code: string): ReadonlySet<number> {
  return new Set(read()[code]?.idxs ?? []);
}

/** Records `idxs` as saved, on top of whatever was already known for this transfer. */
export function markReceived(code: string, expiresAt: string, idxs: number[]) {
  const all = read();
  const merged = new Set(all[code]?.idxs ?? []);
  for (const idx of idxs) merged.add(idx);
  all[code] = { expiresAt, idxs: [...merged].sort((a, b) => a - b) };
  write(all);
}

export function forgetReceived(code: string) {
  const all = read();
  delete all[code];
  write(all);
}
