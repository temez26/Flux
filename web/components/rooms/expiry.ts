import { useSyncExternalStore } from "react";
import { EXPIRY_OPTIONS } from "@/lib/api";

const KEY = "flux.expiry";
const DEFAULT = 86_400;
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
 * How long new shares last, remembered between visits and shared by every room, so rooms shown
 * side by side never disagree about it.
 */
export function useExpiry(): [number, (seconds: number) => void] {
  return [useSyncExternalStore(subscribe, read, () => DEFAULT), choose];
}
