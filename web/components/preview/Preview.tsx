"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fileUrl, inlineUrl, thumbUrl, type FileMeta } from "@/lib/api";
import { basename } from "@/lib/platform/files";
import { formatBytes } from "@/lib/util/format";
import { canPreview, OFFICE_PREVIEW_BYTES, previewKind, thumbnailSource } from "@/lib/preview/preview";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, ExternalIcon, FileTypeIcon } from "../ui/icons";
import { Unavailable, overlayButton, overlayTextButton, type Target, type ViewProps } from "./chrome";
import { DocxView, SheetView, SlidesView, TextView } from "./documents";
import { AudioView, ImageView, PdfView, VideoView } from "./media";

const HISTORY_KEY = "fluxPreview";
const SWIPE_DISTANCE = 60;

/**
 * The file itself, small, for a row or tile in a listing: the server's thumbnail where it
 * has one, the file itself where only the browser can decode it, and the file-type icon
 * once neither works. Give it a key of `file.idx` — a windowed list reuses rows by
 * position, and a stale failure would otherwise follow the row to its next file.
 */
export function FileThumb({ code, file, className }: Target & { className: string }) {
  const [failed, setFailed] = useState(false);
  const source = thumbnailSource(file);
  if (failed || !source) return <FileTypeIcon path={file.path} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
    <img
      src={source === "server" ? thumbUrl(code, file.idx) : fileUrl(code, file.idx)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );
}

/** The single file of a transfer, previewed right on its page. */
export function InlinePreview({ code, file, onExpand }: Target & { onExpand: () => void }) {
  return (
    // Previews that can't be shown render nothing, and then the gap goes too.
    <div className="mt-4 empty:hidden">
      <PreviewContent code={code} file={file} inline onExpand={onExpand} />
    </div>
  );
}

/** Full-screen viewer for the file with index `idx`, stepping through the transfer's previewable files. */
export function PreviewDialog({
  code,
  files,
  idx,
  onChange,
}: {
  code: string;
  files: FileMeta[];
  idx: number | null;
  onChange: (idx: number | null) => void;
}) {
  const previewable = useMemo(() => files.filter(canPreview), [files]);
  const position = previewable.findIndex((f) => f.idx === idx);
  return position < 0 ? null : <Viewer code={code} files={previewable} position={position} onChange={onChange} />;
}

function Viewer({
  code,
  files,
  position,
  onChange,
}: {
  code: string;
  files: FileMeta[];
  position: number;
  onChange: (idx: number | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const closing = useRef(false);
  const file = files[position];
  const prev = files[position - 1];
  const next = files[position + 1];
  const name = basename(file.path);
  const isPdf = previewKind(file.path) === "pdf";

  // Both our own controls and the dialog's native close (e.g. Android's back gesture) end up
  // here, sometimes for the same action, so only the first call may step back in history.
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (history.state?.[HISTORY_KEY]) history.back();
    else onChange(null);
  }, [onChange]);

  useLayoutEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  useEffect(() => {
    // Back (gesture, button or key) closes the viewer instead of leaving the transfer.
    if (!history.state?.[HISTORY_KEY]) history.pushState({ [HISTORY_KEY]: true }, "");
    const onPop = () => onChange(null);
    window.addEventListener("popstate", onPop);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      root.style.overflow = overflow;
    };
  }, [onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        return close();
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.target instanceof HTMLMediaElement) return;
      const target = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : undefined;
      if (!target) return;
      e.preventDefault();
      onChange(target.idx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onChange, close]);

  // Warm the cache so stepping through photos feels instant.
  useEffect(() => {
    for (const neighbour of [prev, next]) {
      if (neighbour && previewKind(neighbour.path) === "image") new Image().src = fileUrl(code, neighbour.idx);
    }
  }, [code, prev, next]);

  function startSwipe(e: PointerEvent) {
    if (e.isPrimary && e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  }

  // Only fires where the content allows horizontal gestures (images, audio); elsewhere the
  // browser takes the pointer for scrolling and cancels it.
  function endSwipe(e: PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const target = dx < 0 ? next : prev;
    if (target) onChange(target.idx);
  }

  return (
    <dialog
      ref={dialog}
      aria-label={name}
      onClose={close}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-black p-0 pb-[env(safe-area-inset-bottom)] text-white [color-scheme:dark] backdrop:bg-black open:flex"
    >
      <header className="flex shrink-0 items-center gap-1 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-2 pl-[max(0.5rem,env(safe-area-inset-left))]">
        <button type="button" onClick={close} aria-label="Close preview" title="Close" className={overlayButton}>
          <CloseIcon />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-white/60 tabular-nums">
            {formatBytes(file.size)}
            {files.length > 1 && ` · ${(position + 1).toLocaleString()} of ${files.length.toLocaleString()}`}
          </p>
        </div>
        {isPdf && navigator.pdfViewerEnabled && (
          <a
            href={inlineUrl(code, file.idx)}
            target="_blank"
            rel="noopener"
            aria-label="Open in new tab"
            title="Open in new tab"
            className={overlayButton}
          >
            <ExternalIcon />
          </a>
        )}
        <a
          href={fileUrl(code, file.idx)}
          download
          aria-label={`Download ${name}`}
          title="Download"
          className={overlayButton}
        >
          <DownloadIcon />
        </a>
      </header>

      <div
        className="relative min-h-0 flex-1"
        onPointerDown={startSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={() => (swipe.current = null)}
      >
        <PreviewContent key={file.idx} code={code} file={file} />
        {prev && (
          <button
            type="button"
            onClick={() => onChange(prev.idx)}
            aria-label="Previous file"
            title="Previous"
            className={`${overlayButton} absolute top-1/2 left-3 -translate-y-1/2 bg-black/50 backdrop-blur max-sm:hidden`}
          >
            <ChevronLeftIcon />
          </button>
        )}
        {next && (
          <button
            type="button"
            onClick={() => onChange(next.idx)}
            aria-label="Next file"
            title="Next"
            className={`${overlayButton} absolute top-1/2 right-3 -translate-y-1/2 bg-black/50 backdrop-blur max-sm:hidden`}
          >
            <ChevronRightIcon />
          </button>
        )}
      </div>

      {files.length > 1 && (
        <nav aria-label="Files" className="flex shrink-0 items-center justify-between px-2 py-2 sm:hidden">
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && onChange(prev.idx)}
            className={overlayTextButton}
          >
            <ChevronLeftIcon className="size-5" />
            Previous
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && onChange(next.idx)}
            className={overlayTextButton}
          >
            Next
            <ChevronRightIcon className="size-5" />
          </button>
        </nav>
      )}
    </dialog>
  );
}

function PreviewContent({
  code,
  file,
  inline = false,
  onExpand,
}: Target & { inline?: boolean; onExpand?: () => void }) {
  const kind = previewKind(file.path);
  const view: ViewProps = { code, file, inline, onExpand, url: fileUrl(code, file.idx) };
  if ((kind === "docx" || kind === "xlsx" || kind === "pptx") && file.size > OFFICE_PREVIEW_BYTES) {
    return <Unavailable {...view} message="This file is too large to preview" />;
  }
  switch (kind) {
    case "image":
      return <ImageView {...view} />;
    case "video":
      return <VideoView {...view} />;
    case "audio":
      return <AudioView {...view} />;
    case "pdf":
      return <PdfView {...view} />;
    case "text":
      return <TextView {...view} />;
    case "docx":
      return <DocxView {...view} />;
    case "xlsx":
      return <SheetView {...view} />;
    case "pptx":
      return <SlidesView {...view} />;
    default:
      return null;
  }
}
