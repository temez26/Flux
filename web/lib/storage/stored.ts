/**
 * A record per transfer code, kept in localStorage and pruned of transfers that have expired
 * as it is read. Where storage is refused (private mode) it simply remembers nothing.
 */
export function storedByCode<T extends { expiresAt: string }>(key: string) {
  const listeners = new Set<() => void>();
  let version = 0;

  function read(): Record<string, T> {
    try {
      const all: Record<string, T> = JSON.parse(localStorage.getItem(key) ?? "{}");
      const now = Date.now();
      for (const [code, value] of Object.entries(all)) {
        if (!(Date.parse(value.expiresAt) > now)) delete all[code];
      }
      return all;
    } catch {
      return {};
    }
  }

  function write(all: Record<string, T>) {
    try {
      localStorage.setItem(key, JSON.stringify(all));
    } catch {
      // Nowhere to keep it.
    }
    version++;
    for (const listener of listeners) listener();
  }

  return {
    read,
    write,
    remove(code: string) {
      const all = read();
      delete all[code];
      write(all);
    },
    /** For useSyncExternalStore. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => version,
  };
}
