import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** Sets the tab title while mounted, e.g. to show progress when the tab is in the background. */
export function useTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => void (document.title = previous);
  }, [title]);
}

/**
 * Runs `load` now and then every `intervalMs`. Hidden tabs skip refreshes (but still load
 * once) and refresh as soon as they become visible again. Failures keep the last state.
 */
export function usePolling(load: () => Promise<void>, intervalMs: number) {
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  useEffect(() => {
    let alive = true;
    let loading = false;
    let loaded = false;
    let timer = 0;
    const tick = async () => {
      if (loading) return;
      loading = true;
      window.clearTimeout(timer);
      if (!document.hidden || !loaded) {
        try {
          await latest.current();
          loaded = true;
        } catch {
          // Keep showing the last state while the server is unreachable.
        }
      }
      loading = false;
      if (alive) timer = window.setTimeout(tick, intervalMs);
    };
    const onVisible = () => !document.hidden && void tick();
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}

const UPLOADING_POLL_MS = 2000;
// Finished transfers are still checked, so the page notices when they're deleted.
const READY_POLL_MS = 30_000;
const OFFLINE_POLL_MS = 4000;

/**
 * Loads transfer metadata and keeps it current: quickly while files are uploading, slowly
 * once complete, and exactly at expiry. `meta` is undefined while loading and null when
 * the transfer doesn't exist (any more). `offline` is set while the server is unreachable.
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
        timer = window.setTimeout(load, UPLOADING_POLL_MS);
        return;
      }
      try {
        const next = await getTransfer(code);
        if (!alive) return;
        loaded = true;
        setMeta(next);
        setOffline(false);
        if (!next) return;
        const interval = next.files.some((f) => f.hash === null) ? UPLOADING_POLL_MS : READY_POLL_MS;
        const untilExpiry = Date.parse(next.expiresAt) - Date.now() + 1000;
        timer = window.setTimeout(load, Math.max(0, Math.min(interval, untilExpiry)));
      } catch {
        if (!alive) return;
        setOffline(true);
        timer = window.setTimeout(load, OFFLINE_POLL_MS);
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
