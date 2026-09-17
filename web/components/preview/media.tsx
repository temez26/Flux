"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { inlineUrl, renderUrl } from "@/lib/api";
import { basename } from "@/lib/platform/files";
import { thumbnailSource } from "@/lib/preview/preview";
import { ExpandIcon, ExternalIcon, FileTypeIcon } from "../ui/icons";
import { Spinner } from "../ui/ui";
import { InlineFrame, Loading, Unavailable, overlayTextButton, type Status, type ViewProps } from "./chrome";

export function ImageView({ code, file, url, inline, onExpand }: ViewProps) {
  const [status, setStatus] = useState<Status>("loading");
  /** Showing the server's rendering because the browser couldn't read the original. */
  const [rendered, setRendered] = useState(false);
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

  // A format this browser can't decode (a HEIC outside Safari, say) is worth one more try
  // against the server's rendering of it before giving up on showing anything at all.
  function failed() {
    if (rendered || thumbnailSource(file) !== "server") return setStatus("failed");
    setRendered(true);
    setStatus("loading");
  }

  const loaded = status === "ready" ? "opacity-100" : "opacity-0";
  const image = (className: string, onClick?: (e: MouseEvent<HTMLImageElement>) => void) => (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
    <img
      key={rendered ? "rendered" : "original"}
      src={rendered ? renderUrl(code, file.idx) : url}
      alt={name}
      draggable={false}
      onClick={onClick}
      onLoad={(e) => {
        const img = e.currentTarget;
        setZoomable(img.naturalWidth > img.clientWidth || img.naturalHeight > img.clientHeight);
        setStatus("ready");
      }}
      onError={failed}
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

export function VideoView({ code, file, url, inline }: ViewProps) {
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

export function AudioView({ code, file, url, inline }: ViewProps) {
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

export function PdfView(view: ViewProps) {
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
