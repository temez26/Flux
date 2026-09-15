"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { fileUrl, inlineUrl, type FileMeta } from "@/lib/api";
import { basename } from "@/lib/files";
import { formatBytes } from "@/lib/format";
import { readSlides, readWorkbook, renderDocx } from "@/lib/office";
import { canPreview, loadText, OFFICE_PREVIEW_BYTES, previewKind, TEXT_PREVIEW_BYTES } from "@/lib/preview";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, ExpandIcon, ExternalIcon, FileTypeIcon } from "./icons";
import { Spinner, buttonClass } from "./ui";

const HISTORY_KEY = "fluxPreview";
const SWIPE_DISTANCE = 60;

// The viewer is always dark, like a photo viewer, so its controls don't follow the theme.
const overlayButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30";
const overlayTextButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30";

interface Target {
  code: string;
  file: FileMeta;
}

/** Inline previews sit in a card and can expand; the others fill the full-screen viewer. */
interface ViewProps extends Target {
  url: string;
  inline: boolean;
  onExpand?: () => void;
}

type Status = "loading" | "ready" | "failed";

function useLoad<T>(url: string, load: (url: string, signal: AbortSignal) => Promise<T>) {
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
export function PreviewDialog({ code, files, idx, onChange }: { code: string; files: FileMeta[]; idx: number | null; onChange: (idx: number | null) => void }) {
  const previewable = useMemo(() => files.filter(canPreview), [files]);
  const position = previewable.findIndex((f) => f.idx === idx);
  return position < 0 ? null : <Viewer code={code} files={previewable} position={position} onChange={onChange} />;
}

function Viewer({ code, files, position, onChange }: { code: string; files: FileMeta[]; position: number; onChange: (idx: number | null) => void }) {
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
          <a href={inlineUrl(code, file.idx)} target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab" className={overlayButton}>
            <ExternalIcon />
          </a>
        )}
        <a href={fileUrl(code, file.idx)} download aria-label={`Download ${name}`} title="Download" className={overlayButton}>
          <DownloadIcon />
        </a>
      </header>

      <div className="relative min-h-0 flex-1" onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={() => (swipe.current = null)}>
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
          <button type="button" disabled={!prev} onClick={() => prev && onChange(prev.idx)} className={overlayTextButton}>
            <ChevronLeftIcon className="size-5" />
            Previous
          </button>
          <button type="button" disabled={!next} onClick={() => next && onChange(next.idx)} className={overlayTextButton}>
            Next
            <ChevronRightIcon className="size-5" />
          </button>
        </nav>
      )}
    </dialog>
  );
}

function PreviewContent({ code, file, inline = false, onExpand }: Target & { inline?: boolean; onExpand?: () => void }) {
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

/** In the viewer, explains why a file can't be shown. Inline, the page's own download button is enough. */
function Unavailable({ code, file, inline, message, children }: ViewProps & { message: string; children?: ReactNode }) {
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

function Loading({ inline }: { inline: boolean }) {
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

function InlineFrame({ onExpand, children }: { onExpand?: () => void; children: ReactNode }) {
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
function Panel({ inline, onExpand, wide = false, children }: { inline: boolean; onExpand?: () => void; wide?: boolean; children: ReactNode }) {
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

const Note = ({ children }: { children: ReactNode }) => <p className="shrink-0 border-b border-line bg-hover px-4 py-2 text-xs text-muted">{children}</p>;

const scrollArea = "min-h-0 flex-1 overflow-auto overscroll-contain";

function ImageView({ code, file, url, inline, onExpand }: ViewProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [zoomable, setZoomable] = useState(false);
  /** Where the image was clicked to zoom in, as fractions of its size. */
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const name = basename(file.path);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!zoom || !el) return;
    el.scrollLeft = zoom.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = zoom.y * el.scrollHeight - el.clientHeight / 2;
  }, [zoom]);

  if (status === "failed") return <Unavailable code={code} file={file} url={url} inline={inline} message="This image format can't be shown in the browser" />;

  const loaded = status === "ready" ? "opacity-100" : "opacity-0";
  const image = (className: string, onClick?: (e: MouseEvent<HTMLImageElement>) => void) => (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
    <img
      src={url}
      alt={name}
      draggable={false}
      onClick={onClick}
      onLoad={(e) => {
        const img = e.currentTarget;
        setZoomable(img.naturalWidth > img.clientWidth || img.naturalHeight > img.clientHeight);
        setStatus("ready");
      }}
      onError={() => setStatus("failed")}
      className={`select-none transition-opacity duration-200 ${loaded} ${className}`}
    />
  );

  if (inline) {
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Open ${name} full screen`}
        className="group relative flex min-h-48 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-hover"
      >
        {status === "loading" && <Spinner className="absolute size-6 text-muted" />}
        {image("max-h-[60vh] max-w-full")}
        <span className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition group-hover:bg-black/75">
          <ExpandIcon className="size-4" />
        </span>
      </button>
    );
  }

  function toggleZoom(e: MouseEvent<HTMLImageElement>) {
    if (zoom) return setZoom(null);
    if (!zoomable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setZoom({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
  }

  return (
    <div ref={scroller} className={`absolute inset-0 ${zoom ? "overflow-auto overscroll-contain" : "flex touch-pan-y items-center justify-center p-2 sm:px-16 sm:pb-6"}`}>
      {status === "loading" && <Loading inline={false} />}
      {zoom ? (
        <div className="grid size-max min-h-full min-w-full place-items-center">{image("max-w-none cursor-zoom-out", toggleZoom)}</div>
      ) : (
        image(`max-h-full max-w-full object-contain ${zoomable ? "cursor-zoom-in" : ""}`, toggleZoom)
      )}
    </div>
  );
}

function VideoView({ code, file, url, inline }: ViewProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable code={code} file={file} url={url} inline={inline} message="This video format can't be played in the browser" />;
  if (inline) {
    return <video src={url} controls playsInline preload="metadata" onError={() => setFailed(true)} className="max-h-[60vh] w-full rounded-xl bg-black" />;
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center sm:px-16 sm:pb-6">
      <video src={url} controls autoPlay playsInline onError={() => setFailed(true)} className="max-h-full max-w-full" />
    </div>
  );
}

function AudioView({ code, file, url, inline }: ViewProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Unavailable code={code} file={file} url={url} inline={inline} message="This audio format can't be played in the browser" />;
  const player = <audio src={url} controls autoPlay={!inline} preload="metadata" onError={() => setFailed(true)} className="w-full" />;
  if (inline) return player;
  return (
    <div className="absolute inset-0 flex touch-pan-y items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <span className="flex size-40 items-center justify-center rounded-3xl bg-accent-solid text-accent-fg shadow-2xl shadow-accent-solid/30 sm:size-48">
          <FileTypeIcon path={file.path} className="size-16" />
        </span>
        <p className="mt-6 w-full truncate font-semibold">{basename(file.path)}</p>
        <div className="mt-6 w-full">{player}</div>
      </div>
    </div>
  );
}

function PdfView(view: ViewProps) {
  const { code, file, inline, onExpand } = view;
  const src = inlineUrl(code, file.idx);
  // Mobile Chrome has no in-page PDF viewer and would download the file instead.
  if (!navigator.pdfViewerEnabled) {
    return (
      <Unavailable {...view} message="This browser can't show PDFs inside Flux">
        <a href={src} target="_blank" rel="noopener" className={`${overlayTextButton} rounded-xl bg-white/10 px-4`}>
          <ExternalIcon className="size-4" />
          Open
        </a>
      </Unavailable>
    );
  }
  // Without the thumbnail sidebar and fitted to width, the page gets all of a narrow frame.
  const frame = <iframe src={`${src}#navpanes=0&view=FitH`} title={basename(file.path)} className="size-full border-0 bg-white" />;
  if (inline) {
    return (
      <InlineFrame onExpand={onExpand}>
        <div className="h-[70vh]">{frame}</div>
      </InlineFrame>
    );
  }
  return (
    <div className="absolute inset-0 flex justify-center sm:px-16 sm:pb-6">
      <div className="size-full max-w-5xl overflow-hidden sm:rounded-xl">{frame}</div>
    </div>
  );
}

function TextView(view: ViewProps) {
  const { data, failed } = useLoad(view.url, loadText);
  if (failed) return <Unavailable {...view} message="This file couldn't be loaded" />;
  if (!data) return <Loading inline={view.inline} />;
  return (
    <Panel inline={view.inline} onExpand={view.onExpand}>
      {data.truncated && <Note>Showing the first {formatBytes(TEXT_PREVIEW_BYTES)}. Download the file to see all of it.</Note>}
      <pre className={`${scrollArea} p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap [tab-size:4] sm:p-6`}>
        {data.text || <span className="text-muted">This file is empty.</span>}
      </pre>
    </Panel>
  );
}

function DocxView(view: ViewProps) {
  const { url, inline, onExpand } = view;
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const controller = new AbortController();
    renderDocx(url, controller.signal, el.shadowRoot ?? el.attachShadow({ mode: "open" })).then(
      () => setStatus("ready"),
      () => controller.signal.aborted || setStatus("failed"),
    );
    return () => controller.abort();
  }, [url]);

  // Pages keep their paper width, so scale them down to fit narrow screens.
  useEffect(() => {
    const el = host.current;
    const wrapper = el?.shadowRoot?.querySelector<HTMLElement>(".docx-wrapper");
    const page = wrapper?.querySelector<HTMLElement>("section.docx");
    if (status !== "ready" || !el || !wrapper || !page) return;
    wrapper.style.zoom = "";
    const width = page.offsetWidth;
    const fit = () => void (wrapper.style.zoom = String(Math.min(1, el.clientWidth / width)));
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [status]);

  if (status === "failed") return <Unavailable {...view} message="This document can't be previewed" />;
  const pages = (
    <div className={inline ? "relative max-h-[60vh] min-h-48 overflow-auto overscroll-contain bg-hover p-3" : "absolute inset-0 overflow-auto overscroll-contain px-2 pt-2 pb-6 sm:px-16"}>
      {status === "loading" && <Loading inline={false} />}
      <div ref={host} className={`transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
  return inline ? <InlineFrame onExpand={onExpand}>{pages}</InlineFrame> : pages;
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const isNumeric = (value: string) => /^[-+]?[\d\s.,]+%?$/.test(value);
const headerCell = "sticky bg-hover px-2.5 py-1 text-xs font-medium text-muted border-line";

function SheetView(view: ViewProps) {
  const { data: sheets, failed } = useLoad(view.url, readWorkbook);
  const [active, setActive] = useState(0);
  if (failed || sheets?.length === 0) return <Unavailable {...view} message="This spreadsheet can't be previewed" />;
  if (!sheets) return <Loading inline={view.inline} />;
  const sheet = sheets[active];

  return (
    <Panel inline={view.inline} onExpand={view.onExpand} wide>
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-1.5">
          {sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                i === active ? "bg-accent/10 text-accent" : "text-muted hover:bg-hover hover:text-fg"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.truncated && <Note>Showing the first 1,000 rows and 100 columns.</Note>}
      {sheet.rows.length ? (
        <div className={scrollArea}>
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={`${headerCell} top-0 left-0 z-20 border-r border-b`} />
                {sheet.rows[0].map((_, c) => (
                  <th key={c} className={`${headerCell} top-0 z-10 border-r border-b`}>
                    {columnName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th className={`${headerCell} left-0 z-10 border-r border-b text-right tabular-nums`}>{r + 1}</th>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      title={cell.length > 40 ? cell : undefined}
                      className={`max-w-72 truncate border-r border-b border-line px-2.5 py-1.5 whitespace-nowrap ${isNumeric(cell) ? "text-right tabular-nums" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-8 text-center text-sm text-muted">This sheet is empty.</p>
      )}
    </Panel>
  );
}

function SlidesView(view: ViewProps) {
  const { data: slides, failed } = useLoad(view.url, readSlides);
  if (failed || slides?.length === 0) return <Unavailable {...view} message="This presentation can't be previewed" />;
  if (!slides) return <Loading inline={view.inline} />;
  return (
    <Panel inline={view.inline} onExpand={view.onExpand}>
      <Note>Text only. Download the file to see the slides as designed.</Note>
      <ol className={`${scrollArea} space-y-3 p-3 sm:p-5`}>
        {slides.map((texts, i) => (
          <li key={i} className="rounded-xl border border-line bg-bg p-4 sm:p-5">
            <p className="text-xs font-medium text-muted">Slide {i + 1}</p>
            {texts.length ? (
              <>
                <p className="mt-1.5 font-semibold text-balance">{texts[0]}</p>
                {texts.slice(1).map((text, j) => (
                  <p key={j} className="mt-1 text-sm whitespace-pre-wrap text-muted">
                    {text}
                  </p>
                ))}
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted italic">No text on this slide</p>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
