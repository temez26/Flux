export interface FileMeta {
  idx: number;
  path: string;
  size: number;
  type: string;
  modified: number | null;
  /** BLAKE3 hex digest; present once the file is fully uploaded and verified. */
  hash: string | null;
  received: number;
  /** Added by someone other than the owner, to a share open to that. */
  added: boolean;
}

export interface TransferMeta {
  code: string;
  title: string;
  /** The text of a text transfer, which has no files; absent for files. */
  note?: string;
  /** Whether anyone with the code may edit the text, not only its owner. */
  editable: boolean;
  /** Moves on with every saved edit, so a save can say which text it was edited from. */
  noteVersion: number;
  /** A public share its owner lets anyone who opens it add files to. */
  open: boolean;
  /** Downloads started from a page, of all or part of the transfer. */
  downloads: number;
  createdAt: string;
  expiresAt: string;
  /** Served from the sender's device: the server has the file list but none of the bytes. */
  hosted: boolean;
  /** Listed for everyone who opens Flux. */
  public: boolean;
  /** Seconds it lasts once its upload completes; null when it counts from creation. */
  lifetime: number | null;
  files: FileMeta[];
}

/** An audio file's tags, each null where the file doesn't say, and how it is encoded. */
export interface AudioTags {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  year?: number | null;
  track?: number | null;
  trackTotal?: number | null;
  disc?: number | null;
  discTotal?: number | null;
  /** Seconds. */
  duration: number;
  /** Kilobits a second. */
  bitrate?: number | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  channels?: number | null;
  /** Whether the file has cover art embedded, served as its thumbnail. */
  cover: boolean;
}

export interface NewFile {
  path: string;
  size: number;
  type: string;
  modified: number | null;
}

export interface Created {
  code: string;
  token: string;
  expiresAt: string;
}

/** A transfer's counts and state without its file list. */
export interface Summary {
  code: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  /** Seconds it lasts once its upload completes; null when it counts from creation. */
  lifetime: number | null;
  hosted: boolean;
  open: boolean;
  downloads: number;
  /** A text transfer rather than files. */
  note: boolean;
  files: number;
  size: number;
  complete: boolean;
  /** The only file, once it is on the server in full; absent from an older server. */
  thumb?: number | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** How long a transfer can be kept, the only lengths the server accepts. */
export const EXPIRY_OPTIONS = [
  { label: "5 minutes", value: 300 },
  { label: "15 minutes", value: 900 },
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21_600 },
  { label: "1 day", value: 86_400 },
  { label: "3 days", value: 259_200 },
  { label: "7 days", value: 604_800 },
];

const transferUrl = (code: string) => `/api/transfers/${code}`;
export const fileUrl = (code: string, idx: number) => `${transferUrl(code)}/files/${idx}`;
/** Small, server-generated preview of an image file. */
export const thumbUrl = (code: string, idx: number) => `${fileUrl(code, idx)}/thumb`;
/** A bigger server-rendered copy, for showing an image the browser can't decode itself. */
export const renderUrl = (code: string, idx: number) => `${thumbUrl(code, idx)}?full`;
/** What an audio file's tags and encoding say about it; its cover art is its thumbnail. */
export const tagsUrl = (code: string, idx: number) => `${fileUrl(code, idx)}/tags`;
/** Served inline for the browser's PDF viewer; the server only allows this for PDFs. */
export const inlineUrl = (code: string, idx: number) => `${fileUrl(code, idx)}?inline`;
/**
 * File indices as the ranges the zip endpoint reads, such as "0-12,15". A folder's files sit
 * next to each other in a listing, so selecting one costs a few characters, not thousands.
 */
export function selectionSpec(idxs: number[]): string {
  const sorted = [...new Set(idxs)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    ranges.push(i === j ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return ranges.join(",");
}

/** The whole transfer as a zip, or just the files in `idxs`. */
export const zipUrl = (code: string, idxs?: number[]) =>
  idxs ? `${transferUrl(code)}/zip?files=${selectionSpec(idxs)}` : `${transferUrl(code)}/zip`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "Can't reach the Flux server");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function createTransfer(files: NewFile[], expiresIn: number, isPublic: boolean, hosted: boolean) {
  return request<Created>("/api/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, expiresIn, public: isPublic, hosted }),
  });
}

/** A transfer of text, kept on the server where it can be edited, rather than of files. */
export function createNote(text: string, editable: boolean, expiresIn: number, isPublic: boolean) {
  return request<Created>("/api/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [], note: text, editable, expiresIn, public: isPublic }),
  });
}

export interface NoteState {
  text: string;
  version: number;
}

/**
 * Saves edited text, naming the version it was edited from. When someone else saved first the
 * save doesn't happen, and what comes back instead is the text as it now is.
 */
export async function saveNote(
  code: string,
  token: string | undefined,
  text: string,
  version: number,
): Promise<{ saved: NoteState } | { conflict: NoteState }> {
  let res: Response;
  try {
    res = await fetch(`${transferUrl(code)}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(token ? auth(token) : {}) },
      body: JSON.stringify({ text, version }),
    });
  } catch {
    throw new ApiError(0, "Can't reach the Flux server");
  }
  const body = await res.json().catch(() => null);
  if (res.ok) return { saved: body };
  if (res.status === 409) return { conflict: body };
  throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
}

/** What peers need to find each other: this deployment's STUN port, and the address this device reaches it from. */
export function getConfig() {
  // An older server says nothing of the address.
  return request<{ stunPort: number | null; address?: string }>("/api/config");
}

/**
 * Public transfers, newest first. `q` narrows by title and `kind` to files or text; `limit` is how
 * many to ask for.
 */
export function listPublic(options: { q?: string; limit?: number; kind?: "files" | "text" } = {}) {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.kind) params.set("kind", options.kind);
  const query = params.toString();
  return request<Summary[]>(`/api/public${query ? `?${query}` : ""}`);
}

/** Revalidated with the server's ETag, so polling an unchanged transfer is cheap. */
export interface AddedFile {
  idx: number;
  /** Differs from the path asked for when the transfer already held one by that name. */
  path: string;
}

/**
 * Adds files to a transfer, answering with the index and final path of each, in order. The
 * owner's token adds to any transfer; to an open share anyone may add, under a folder named by
 * `from`, and gets back a token for uploading what they added — to send again with more.
 */
export function appendFiles(code: string, token: string | undefined, files: NewFile[], from?: string) {
  return request<{ files: AddedFile[]; token?: string }>(`${transferUrl(code)}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? auth(token) : {}) },
    body: JSON.stringify({ files, from }),
  });
}

export function getTransfer(code: string): Promise<TransferMeta | null> {
  return orNull(request<TransferMeta>(transferUrl(code), { cache: "no-cache" }));
}

export function getSummary(code: string): Promise<Summary | null> {
  return orNull(request<Summary>(`${transferUrl(code)}/summary`));
}

export function loadTags(url: string, signal?: AbortSignal): Promise<AudioTags> {
  return request<AudioTags>(url, { signal });
}

/** Records that a download of this transfer started. Best effort: it never holds a download up. */
export function countDownload(code: string) {
  void fetch(`${transferUrl(code)}/downloads`, { method: "POST", keepalive: true }).catch(() => {});
}

/** Changes a transfer its owner holds the token for; `expiresIn` counts from now. */
export function updateTransfer(
  code: string,
  token: string,
  changes: { expiresIn?: number; open?: boolean; editable?: boolean; public?: boolean },
) {
  return request<{ expiresAt: string; open: boolean; editable: boolean; public: boolean; lifetime: number | null }>(
    transferUrl(code),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth(token) },
      body: JSON.stringify(changes),
    },
  );
}

export function deleteTransfer(code: string, token: string) {
  return request<void>(transferUrl(code), { method: "DELETE", headers: auth(token) });
}

export function deleteFile(code: string, token: string, idx: number) {
  return request<void>(fileUrl(code, idx), { method: "DELETE", headers: auth(token) });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
