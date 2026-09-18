import type { FileMeta } from "../api";

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

// What the server can decode. HEIF is in here because only Safari draws a HEIC itself, and
// an iPhone shoots them by default, so everywhere else depends on the server having a go.
const SERVER_THUMBNAIL = /\.(jpe?g|png|gif|webp|bmp|tiff?|ico|hei[cf]|hif|avif)$/i;
// The rest only the browser can draw, and only by loading the whole file — so a listing
// does that for small ones and gives up after.
const SELF_THUMBNAIL_BYTES = 8e6;
// Audio the server reads tags from, whose embedded cover art it serves as the thumbnail.
const SERVER_COVER = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus)$/i;

/** Where a listing should get this file's small preview, if it can have one at all. */
export function thumbnailSource(file: FileMeta): "server" | "file" | null {
  const kind = previewKind(file.path);
  if (kind === "audio") return hasTags(file) ? "server" : null;
  if (!canPreview(file) || kind !== "image") return null;
  if (SERVER_THUMBNAIL.test(file.path)) return "server";
  return file.size <= SELF_THUMBNAIL_BYTES ? "file" : null;
}

/** Whether the server can read this audio file's tags and cover art. */
export const hasTags = (file: FileMeta) => canPreview(file) && SERVER_COVER.test(file.path);

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
