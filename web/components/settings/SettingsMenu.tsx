"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { EXPIRY_OPTIONS } from "@/lib/api";
import { SettingsIcon } from "../ui/icons";
import { IconButton, Segmented } from "../ui/ui";
import { useExpiry } from "./expiry";
import { InstallApp } from "./InstallApp";
import { NotificationSwitch } from "./NotificationSwitch";
import { isSwitchingTheme, useTheme } from "./theme";
import { THEMES } from "./themes";

// Open from the header, or from any form's "Change" next to how long its share will last.
let open = false;
const listeners = new Set<() => void>();

function setOpen(value: boolean) {
  open = value;
  for (const listener of listeners) listener();
}

export const openSettings = () => setOpen(true);

function useOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}

/** The header's settings button, and the panel it opens: what applies to everything shared from here. */
export function SettingsMenu() {
  const isOpen = useOpen();
  const [expiresIn, setExpiresIn] = useExpiry();
  const [theme, setTheme] = useTheme();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  const id = useId();

  useEffect(() => {
    if (!isOpen) return;
    firstField.current?.focus();
    const close = (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) button.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    const onPointer = (e: PointerEvent) => {
      // Mid theme change a click inside the panel arrives as one on the root, outside it.
      if (isSwitchingTheme()) return;
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const onFocus = (e: FocusEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <IconButton
        ref={button}
        label="Settings"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${id}-panel` : undefined}
        onClick={() => setOpen(!isOpen)}
        className={isOpen ? "bg-hover text-fg" : ""}
      >
        <SettingsIcon />
      </IconButton>
      {isOpen && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-labelledby={`${id}-title`}
          className="absolute top-full right-0 z-40 mt-2 w-[min(17rem,calc(100vw-2rem))] origin-top-right animate-pop-in surface floating rounded-2xl p-4"
        >
          <h2 id={`${id}-title`} className="text-base font-semibold">
            Settings
          </h2>

          <div className="mt-4 flex items-center justify-between gap-3">
            <label htmlFor={`${id}-expiry`} className="text-sm font-medium">
              Keep shares for
            </label>
            <select
              ref={firstField}
              id={`${id}-expiry`}
              value={expiresIn}
              onChange={(e) => setExpiresIn(Number(e.target.value))}
              className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm font-medium">Theme</p>
            <Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <NotificationSwitch />
          </div>
          <InstallApp />
        </div>
      )}
    </div>
  );
}
