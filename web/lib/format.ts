const UNITS = ["B", "kB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatRemaining(expiresAt: string, now = Date.now()): string {
  const s = (Date.parse(expiresAt) - now) / 1000;
  if (s <= 0) return "Expired";
  if (s < 3600) return `Expires in ${Math.ceil(s / 60)} min`;
  if (s < 86_400) return `Expires in ${Math.round(s / 3600)} h`;
  return `Expires in ${Math.round(s / 86_400)} days`;
}

/**
 * How long a transfer lasts, for a listing holding both kinds.
 *
 * One served from this device has an expiry on the server, but that is only how long the
 * code is reserved: the transfer itself ends with the tab serving it. Reporting the expiry
 * would promise days for something that may already be over.
 */
export function formatLifetime(expiresAt: string, hosted: boolean, serving: boolean, now = Date.now()): string {
  if (!hosted) return formatRemaining(expiresAt, now);
  return serving ? "While this page is open" : "Ended when the page closed";
}

export function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Accepts a code in any casing, with or without the dash, or a full share link. */
export function normalizeCode(input: string): string | null {
  const last = input.trim().split("/").filter(Boolean).pop() ?? "";
  const code = last.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^[2-9a-hjkmnp-z]{8}$/.test(code) ? code : null;
}
