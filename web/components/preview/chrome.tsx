"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fileUrl, type FileMeta } from "@/lib/api";
import { DownloadIcon, ExpandIcon, FileTypeIcon } from "../icons";
import { Spinner, buttonClass } from "../ui";

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
export function Unavailable({ code, file, inline, message, children }: ViewProps & { message: string; children?: ReactNode }) {
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

export function InlineFrame({ onExpand, children }: { onExpand?: () => void; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pr-1 pl-3">
        <span className="text-xs font-medium text-muted">Preview</span>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-hover hover:text-fg"
          >
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
export function Panel({ inline, onExpand, wide = false, children }: { inline: boolean; onExpand?: () => void; wide?: boolean; children: ReactNode }) {
  if (inline) {
    return (
      <InlineFrame onExpand={onExpand}>
        <div className="flex max-h-[60vh] flex-col">{children}</div>
      </InlineFrame>
    );
  }
  return (
    <div className="absolute inset-0 flex justify-center sm:px-16 sm:pb-6">
      <div className={`flex min-h-0 w-full flex-col overflow-hidden bg-surface text-fg [color-scheme:light_dark] sm:rounded-2xl ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
        {children}
      </div>
    </div>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <p className="shrink-0 border-b border-line bg-hover px-4 py-2 text-xs text-muted">{children}</p>;

export const scrollArea = "min-h-0 flex-1 overflow-auto overscroll-contain";
