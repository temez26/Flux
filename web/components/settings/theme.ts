import { useSyncExternalStore } from "react";
import { DEFAULT_THEME as DEFAULT, THEME_KEY as KEY, THEMES, type Theme } from "./themes";

const listeners = new Set<() => void>();

const isTheme = (value: unknown): value is Theme => THEMES.some((t) => t.value === value);

function read(): Theme {
  const current = document.documentElement.dataset.theme;
  return isTheme(current) ? current : DEFAULT;
}

/** Keeps the browser's own bars the colour of the page, which some installed apps take from one untagged meta. */
export function syncThemeColor() {
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])') ?? document.createElement("meta");
  if (!meta.isConnected) {
    meta.name = "theme-color";
    document.head.prepend(meta);
  }
  meta.content = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === DEFAULT) delete root.dataset.theme;
  else root.dataset.theme = theme;
  syncThemeColor();
  for (const listener of listeners) listener();
}

let switching = false;

/**
 * Whether a theme change is cross-fading the page. Meanwhile the browser shows snapshots over
 * the page and hands every click to the root element, whatever was under the pointer.
 */
export const isSwitchingTheme = () => switching;

function choose(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  // A cross-fade where the browser can do one cheaply; otherwise the change is instant.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && document.startViewTransition) {
    switching = true;
    document.startViewTransition(() => apply(theme)).finished.finally(() => (switching = false));
  } else apply(theme);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribe, read, () => DEFAULT), choose];
}
