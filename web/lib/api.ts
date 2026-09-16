export interface FileMeta {
  idx: number;
  path: string;
  size: number;
  type: string;
  modified: number | null;
  /** BLAKE3 hex digest; present once the file is fully uploaded and verified. */
  hash: string | null;
  received: number;
}

export interface TransferMeta {
  code: string;
  createdAt: string;
  expiresAt: string;
  /** Served from the sender's device: the server has the file list but none of the bytes. */
  hosted: boolean;
  files: FileMeta[];
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
  hosted: boolean;
  files: number;
  size: number;
  complete: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const transferUrl = (code: string) => `/api/transfers/${code}`;
export const fileUrl = (code: string, idx: number) => `${transferUrl(code)}/files/${idx}`;
/** Small, server-generated preview of an image file. */
export const thumbUrl = (code: string, idx: number) => `${fileUrl(code, idx)}/thumb`;
/** Served inline for the browser's PDF viewer; the server only allows this for PDFs. */
export const inlineUrl = (code: string, idx: number) => `${fileUrl(code, idx)}?inline`;
export const zipUrl =(code: string) => `${transferUrl(code)}/zip`;
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

export function listPublic() {
  return request<Summary[]>("/api/public");
}

/** Revalidated with the server's ETag, so polling an unchanged transfer is cheap. */
export function getTransfer(code: string): Promise<TransferMeta | null> {
  return orNull(request<TransferMeta>(transferUrl(code), { cache: "no-cache" }));
}

export function getSummary(code: string): Promise<Summary | null> {
  return orNull(request<Summary>(`${transferUrl(code)}/summary`));
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
