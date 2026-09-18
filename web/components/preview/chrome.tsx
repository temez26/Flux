"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fileUrl, type FileMeta } from "@/lib/api";
import { copyText } from "@/lib/platform/clipboard";
import { toast } from "@/lib/alerts/toast";
import { CopyIcon, DownloadIcon, ExpandIcon, FileTypeIcon } from "../ui/icons";
import { Spinner, buttonClass } from "../ui/ui";

// The viewer is always dark, like a photo viewer, so its controls don't follow the theme.
export const overlayButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30";
export const overlayTextButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30";

export interface Target {
  code: string;
  file: FileMeta;
}

/** Inline previews sit in a card and can expand; the others fill the full-screen viewer. */
export interface ViewProps extends Target {
  url: string;
  inline: boolean;
  onExpand?: () => void;
}

export type Status = "loading" | "ready" | "failed";

/**
 * An image's loading state, for fading it in. One the browser already holds, as a neighbour
 * warmed by the viewer, is found ready before its first paint, so it is shown at once rather
 * than flashing in from nothing. Pass `ref` to the <img>, and `onLoad`/`onError` with it.
 */
export function useImageStatus() {
  const [status, setStatus] = useState<Status>("loading");
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) setStatus((s) => (s === "loading" ? "ready" : s));
  }, []);
  return {
    status,
    setStatus,
    ref,
    onLoad: () => setStatus("ready"),
    onError: () => setStatus("failed"),
  };
}

export function useLoad<T>(url: string, load: (url: string, signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ data?: T; failed?: boolean }>({});
  useEffect(() => {
    const controller = new AbortController();
    load(url, controller.signal).then(
      (data) => setResult({ data }),
      () => controller.signal.aborted || setResult({ failed: true }),
    );
    return () => controller.abort();
  }, [url, load]);
  return result;
}

/** In the viewer, explains why a file can't be shown. Inline, the page's own download button is enough. */
export function Unavailable({
  code,
  file,
  inline,
  message,
  children,
}: ViewProps & { message: string; children?: ReactNode }) {
  if (inline) return null;
  return (
    <div className="absolute inset-0 flex touch-pan-y items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-white/10 text-white/80">
          <FileTypeIcon path={file.path} className="size-8" />
        </span>
        <p className="mt-4 font-semibold">{message}</p>
        <p className="mt-1 text-sm text-white/60">Download it to open it on your device.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {children}
          <a href={fileUrl(code, file.idx)} download className={buttonClass("primary")}>
            <DownloadIcon className="size-4" />
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

export function Loading({ inline }: { inline: boolean }) {
  return inline ? (
    <div className="flex h-48 items-center justify-center rounded-xl border border-line bg-bg">
      <Spinner className="size-6 text-muted" />
    </div>
  ) : (
    <div className="absolute inset-0 flex items-center justify-center">
      <Spinner className="size-6 text-white/60" />
    </div>
  );
}

const frameButton =
  "inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-hover hover:text-fg";

/** Copies what a text preview shows — on a phone, usually the reason for opening it at all. */
export function CopyButton({ text }: { text: string }) {
  async function copy() {
    try {
      await copyText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy the text", "err");
    }
  }
  return (
    <button type="button" onClick={copy} className={frameButton}>
      <CopyIcon className="size-3.5" />
      Copy
    </button>
  );
}

export function InlineFrame({
  onExpand,
  aside,
  children,
}: {
  onExpand?: () => void;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pr-1 pl-3">
        <span className="mr-auto text-xs font-medium text-muted">Preview</span>
        {aside}
        {onExpand && (
          <button type="button" onClick={onExpand} className={frameButton}>
            <ExpandIcon className="size-3.5" />
            Full screen
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** A sheet for documents: scrolling inside the card, or a centred page in the viewer. */
export function Panel({
  inline,
  onExpand,
  aside,
  wide = false,
  children,
}: {
  inline: boolean;
  onExpand?: () => void;
  /** Actions for what the panel shows, beside its title inline or above it full screen. */
  aside?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  if (inline) {
    return (
      <InlineFrame onExpand={onExpand} aside={aside}>
        <div className="flex max-h-[60vh] flex-col">{children}</div>
      </InlineFrame>
    );
  }
  return (
    <div className="absolute inset-0 flex justify-center sm:px-16 sm:pb-6">
      <div
        className={`flex min-h-0 w-full flex-col overflow-hidden bg-surface text-fg [color-scheme:light_dark] sm:rounded-2xl ${wide ? "max-w-6xl" : "max-w-4xl"}`}
      >
        {aside && <div className="flex shrink-0 justify-end border-b border-line px-2 py-1">{aside}</div>}
        {children}
      </div>
    </div>
  );
}

export const Note = ({ children }: { children: ReactNode }) => (
  <p className="shrink-0 border-b border-line bg-hover px-4 py-2 text-xs text-muted">{children}</p>
);

export const scrollArea = "min-h-0 flex-1 overflow-auto overscroll-contain";
