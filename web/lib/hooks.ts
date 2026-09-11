import { useEffect, useState, useSyncExternalStore } from "react";
import { getTransfer, type TransferMeta } from "./api";

const noSubscribe = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Keeps the screen on while a transfer runs; mobile browsers suspend network work when it sleeps. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let disposed = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (disposed) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

export function useLeaveGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [enabled]);
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const POLL_MS = 2000;

/**
 * Loads transfer metadata and keeps polling while any file is still uploading.
 * `meta` is undefined while loading and null when the transfer doesn't exist.
 */
export function useTransferMeta(code: string, enabled: boolean) {
  const [meta, setMeta] = useState<TransferMeta | null>();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    let alive = true;
    let loaded = false;
    const load = async () => {
      if (document.hidden && loaded) {
        timer = window.setTimeout(load, POLL_MS);
        return;
      }
      try {
        const next = await getTransfer(code);
        if (!alive) return;
        loaded = true;
        setMeta(next);
        setOffline(false);
        if (next?.files.some((f) => f.hash === null)) timer = window.setTimeout(load, POLL_MS);
      } catch {
        if (!alive) return;
        setOffline(true);
        timer = window.setTimeout(load, POLL_MS * 2);
      }
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [code, enabled]);

  return { meta, offline };
}
