import { useSyncExternalStore } from "react";
import { EXPIRY_OPTIONS } from "@/lib/api";

const KEY = "flux.expiry";
const DEFAULT = 3600;
const listeners = new Set<() => void>();
/** Kept here too, so a choice holds for the visit where storage is refused. */
let current: number | undefined;

function stored(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return EXPIRY_OPTIONS.some((e) => e.value === value) ? value : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const read = () => (current ??= stored());

function choose(seconds: number) {
  current = seconds;
  try {
    localStorage.setItem(KEY, String(seconds));
  } catch {}
  for (const listener of listeners) listener();
}

/**
 * How long new shares last, set in Settings, remembered between visits and used by every room, so
 * rooms shown side by side never disagree about it.
 */
export function useExpiry(): [number, (seconds: number) => void] {
  return [useSyncExternalStore(subscribe, read, () => DEFAULT), choose];
}

/** How a length shares last is written, e.g. "1 hour". */
export const expiryLabel = (seconds: number) =>
  EXPIRY_OPTIONS.find((option) => option.value === seconds)?.label ?? `${Math.round(seconds / 60)} minutes`;
