/** Transfers created on this device, so the sender can reopen, resume or delete them. */
export interface Owned {
  token: string;
  expiresAt: string;
  /** Listed in the public space. */
  public?: boolean;
  /** Served from this device; nothing was uploaded. */
  hosted?: boolean;
  /** A collection this device opened for others to send files into. */
  collect?: boolean;
  count: number;
  size: number;
  createdAt: number;
}

const KEY = "flux.owned";

function read(): Record<string, Owned> {
  try {
    const all: Record<string, Owned> = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const now = Date.now();
    for (const [code, owned] of Object.entries(all)) {
      if (Date.parse(owned.expiresAt) <= now) delete all[code];
    }
    return all;
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let version = 0;

/** For useSyncExternalStore: what this device owns changes as transfers are made, changed and removed. */
export const subscribeOwned = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const ownedVersion = () => version;

function write(all: Record<string, Owned>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable (private mode); ownership then lasts for this tab only.
  }
  version++;
  for (const listener of listeners) listener();
}

export function listOwned(): [string, Owned][] {
  return Object.entries(read()).sort((a, b) => b[1].createdAt - a[1].createdAt);
}

export const getOwned = (code: string): Owned | undefined => read()[code];

export function saveOwned(code: string, owned: Owned) {
  write({ ...read(), [code]: owned });
}

export function removeOwned(code: string) {
  const all = read();
  delete all[code];
  write(all);
}
