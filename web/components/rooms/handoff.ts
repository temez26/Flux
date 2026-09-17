import { useEffect, useRef } from "react";
import type { Picked } from "@/lib/platform/files";

/** What the home page hands to a room: files for the file rooms, text for the text room. */
export interface Handoffs {
  private?: Picked[];
  public?: Picked[];
  text?: string;
}

export type Target = keyof Handoffs;

// Files can't travel in an address, so they wait here for the room to open — on its own page
// or beside the home page — and are taken once.
const waiting: Handoffs = {};
const listeners = new Set<() => void>();

export function handOff<T extends Target>(target: T, payload: NonNullable<Handoffs[T]>) {
  waiting[target] = payload;
  for (const listener of listeners) listener();
}

/** Calls `take` with whatever is handed to `target`, now and whenever more arrives. */
export function useHandoff<T extends Target>(target: T, take: (payload: NonNullable<Handoffs[T]>) => void) {
  const latest = useRef(take);
  useEffect(() => {
    latest.current = take;
  });
  useEffect(() => {
    const check = () => {
      const payload = waiting[target];
      if (payload === undefined) return;
      delete waiting[target];
      latest.current(payload as NonNullable<Handoffs[T]>);
    };
    check();
    listeners.add(check);
    return () => void listeners.delete(check);
  }, [target]);
}
