import type { FileMeta } from "./api";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "docx" | "xlsx" | "pptx";

// Only formats browsers can show themselves; the rest (e.g. HEIC outside Safari) fall back on error.
const KINDS: [RegExp, PreviewKind][] = [
  [/\.(jpe?g|png|gif|webp|avif|bmp|ico|svg|heic|heif|tiff?)$/i, "image"],
  [/\.(mp4|m4v|mov|webm|ogv)$/i, "video"],
  [/\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba)$/i, "audio"],
  [/\.pdf$/i, "pdf"],
  [/\.docx$/i, "docx"],
  [/\.xlsx$/i, "xlsx"],
  [/\.pptx$/i, "pptx"],
  [
    /(\.(txt|text|md|markdown|rst|log|csv|tsv|json|jsonc|ndjson|xml|ya?ml|toml|ini|cfg|conf|env|properties|srt|vtt|sh|bash|zsh|fish|ps1|bat|cmd|py|rb|php|pl|js|mjs|cjs|jsx|ts|tsx|vue|svelte|html?|css|scss|sass|less|c|h|cc|cpp|hpp|cs|java|kt|kts|swift|go|rs|dart|lua|r|sql|gradle|diff|patch)|\/(readme|license|changelog|dockerfile|makefile|\.gitignore|\.dockerignore|\.editorconfig|\.env))$/i,
    "text",
  ],
];

export function previewKind(path: string): PreviewKind | null {
  const withSlash = `/${path}`;
  return KINDS.find(([pattern]) => pattern.test(withSlash))?.[1] ?? null;
}

/** Only files the server has in full can be previewed. */
export const canPreview = (file: FileMeta) => !!file.hash && previewKind(file.path) !== null;

// Listings draw the file itself only for images, and only small ones: there is no
// server-side thumbnail, so a tile costs the whole file.
const THUMBNAIL_BYTES = 8e6;

/** Whether a listing can show the file itself in place of its file-type icon. */
export const canThumbnail = (file: FileMeta) => canPreview(file) && previewKind(file.path) === "image" && file.size <= THUMBNAIL_BYTES;

export const TEXT_PREVIEW_BYTES = 512 * 1024;
/** Office files are parsed in memory, so very large ones are left to a download. */
export const OFFICE_PREVIEW_BYTES = 50e6;

export async function loadText(url: string, signal: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(url, { signal, headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } });
  // An empty file has no satisfiable range.
  if (res.status === 416) return { text: "", truncated: false };
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const bytes = await res.arrayBuffer();
  const total = Number(res.headers.get("Content-Range")?.split("/")[1] ?? bytes.byteLength);
  return {
    text: new TextDecoder().decode(bytes.slice(0, TEXT_PREVIEW_BYTES)),
    truncated: total > TEXT_PREVIEW_BYTES,
  };
}

export async function loadBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.arrayBuffer();
}
