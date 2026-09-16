import { storedByCode } from "./stored";

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

const store = storedByCode<Owned>("flux.owned");

/** For useSyncExternalStore: what this device owns changes as transfers are made, changed and removed. */
export const subscribeOwned = store.subscribe;
export const ownedVersion = store.version;

export function listOwned(): [string, Owned][] {
  return Object.entries(store.read()).sort((a, b) => b[1].createdAt - a[1].createdAt);
}

export const getOwned = (code: string): Owned | undefined => store.read()[code];

export function saveOwned(code: string, owned: Owned) {
  store.write({ ...store.read(), [code]: owned });
}

export const removeOwned = store.remove;
