import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getTransfer, type TransferMeta } from "./api";
import { notify } from "./notify";
import { getOwned, ownedVersion, subscribeOwned } from "./owned";

const noSubscribe = () => () => {};

// A hidden tab never animates, so a frame that may never come must not block the work.
const PAINT_TIMEOUT_MS = 50;
// A desktop file dialog hands the selection over at once; this keeps the wait from
// flashing there while still catching the slow copy on phones.
const PICKER_GRACE_MS = 150;
// Waiting this long means something is wrong: a phone that can't hand over the selection
// says nothing at all about it, so the page has to notice on its own.
const PICKER_STALL_MS = 10_000;

/**
 * Resolves once the browser has had a chance to paint. Every microtask runs before
 * rendering, so `await`ing an already-resolved value leaves a spinner set in the same turn
 * invisible; await this instead before work that blocks the main thread.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, PAINT_TIMEOUT_MS);
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      window.setTimeout(resolve, 0);
    });
  });
}

/**
 * Opens a file input and reports the gap between the picker closing and the browser
 * handing the files over. Phones copy (and transcode) the whole selection first, which
 * takes seconds for photos and videos and fires no event of its own, so without this the
 * page looks untouched — and unresponsive — long after the user confirmed the picker.
 */
export function useFilePicker() {
  const [waiting, setWaiting] = useState(false);
  // Android's picker drops a selection it can't hand over without telling anyone, and
  // Chrome there sends no `cancel` either, so a wait that goes nowhere needs explaining.
  const [stalled, setStalled] = useState(false);
  const pending = useRef(false);
  /** The picker took the screen, so coming back means it has had its say. */
  const away = useRef(false);
  const timer = useRef(0);
  const stall = useRef(0);

  const settle = useCallback(() => {
    pending.current = false;
    away.current = false;
    window.clearTimeout(timer.current);
    window.clearTimeout(stall.current);
    setWaiting(false);
    setStalled(false);
  }, []);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => pending.current && setWaiting(true), PICKER_GRACE_MS);
  }, []);

  useEffect(() => {
    // The picker is a native overlay, so the page only learns it closed by coming back.
    // Only once it has is a wait worth explaining: before that the delay is the picker
    // opening, and on a desktop dialog the page can sit behind it for as long as it likes.
    const returned = () => {
      if (!pending.current || document.hidden) return;
      show();
      // Clicking the input focuses the window before the picker is anywhere near the
      // screen, and a desktop dialog never takes it at all, so only a picker that has
      // actually been and gone is one that can have dropped the selection.
      if (!away.current) return;
      away.current = false;
      window.clearTimeout(stall.current);
      stall.current = window.setTimeout(() => pending.current && setStalled(true), PICKER_STALL_MS);
    };
    const moved = () => {
      if (document.hidden) away.current = pending.current;
      else returned();
    };
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", moved);
    // Backing out of the picker fires `cancel` on the input (React doesn't surface it for
    // file inputs, so listen natively); touching the page again covers browsers that don't
    // send it, so the wait can never get stuck.
    window.addEventListener("cancel", settle, true);
    window.addEventListener("pointerdown", settle);
    return () => {
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", moved);
      window.removeEventListener("cancel", settle, true);
      window.removeEventListener("pointerdown", settle);
      window.clearTimeout(timer.current);
      window.clearTimeout(stall.current);
    };
  }, [settle, show]);

  /**
   * Call right before opening a picker. A phone with a full camera roll can take seconds
   * just to put the picker on screen, and the page is still the thing being looked at for
   * all of it, so the wait starts here rather than when the files come back.
   */
  const arm = useCallback(() => {
    pending.current = true;
    show();
  }, [show]);

  return { waiting, stalled, arm, settle };
}

/**
 * Notifies each time `when` turns true — but not for a state the page opened in, which the
 * person opening it can already see.
 */
export function useNotifyWhen(when: boolean, title: string, body?: string) {
  const previous = useRef(when);
  useEffect(() => {
    if (when && !previous.current) void notify(title, body);
    previous.current = when;
  }, [when, title, body]);
}

/** This device's record of owning a transfer, kept current as it changes. */
export function useOwned(code: string) {
  useSyncExternalStore(subscribeOwned, ownedVersion, ownedVersion);
  return getOwned(code);
}

const reloads = new Map<string, Set<() => void>>();

/** Asks every page following a transfer to load it again now, rather than at its next poll. */
export function reloadTransfer(code: string) {
  for (const reload of reloads.get(code) ?? []) reload();
}

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
        // A collection can gain files at any moment, however finished it looks. A transfer
        // served from a device never gets hashes, which would otherwise read as always uploading.
        const interval = next.collect || (!next.hosted && next.files.some((f) => f.hash === null)) ? UPLOADING_POLL_MS : READY_POLL_MS;
        const untilExpiry = Date.parse(next.expiresAt) - Date.now() + 1000;
        timer = window.setTimeout(load, Math.max(0, Math.min(interval, untilExpiry)));
      } catch {
        if (!alive) return;
        setOffline(true);
        timer = window.setTimeout(load, OFFLINE_POLL_MS);
      }
    };
    const now = () => {
      window.clearTimeout(timer);
      void load();
    };
    const followers = reloads.get(code) ?? new Set();
    reloads.set(code, followers.add(now));
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      followers.delete(now);
      if (!followers.size) reloads.delete(code);
    };
  }, [code, enabled]);

  return { meta, offline };
}
