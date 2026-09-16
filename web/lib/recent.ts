import { storedByCode } from "./stored";

/**
 * Transfers this device opened someone else's code for, so getting back to one after closing
 * its tab doesn't mean finding the code again.
 */
export interface Recent {
  title: string;
  files: number;
  size: number;
  expiresAt: string;
  hosted?: boolean;
  collect?: boolean;
  openedAt: number;
}

/** Enough to find last week's transfers again without the list turning into a history. */
const MAX_RECENT = 20;

const store = storedByCode<Recent>("flux.recent");

export const subscribeRecent = store.subscribe;
export const recentVersion = store.version;

export function listRecent(): [string, Recent][] {
  return Object.entries(store.read()).sort((a, b) => b[1].openedAt - a[1].openedAt);
}

/** Records opening a transfer, moving it to the top if it was already listed. */
export function rememberRecent(code: string, recent: Omit<Recent, "openedAt">, now = Date.now()) {
  const kept = listRecent()
    .filter(([other]) => other !== code)
    .slice(0, MAX_RECENT - 1);
  store.write(Object.fromEntries([[code, { ...recent, openedAt: now }], ...kept]));
}

export const forgetRecent = store.remove;

export function clearRecent() {
  store.write({});
}
