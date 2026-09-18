"use client";

import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { inlineUrl, renderUrl, tagsUrl, type AudioTags } from "@/lib/api";
import { basename } from "@/lib/platform/files";
import { audioDetails, knownTags, loadKnownTags } from "@/lib/preview/audio";
import { hasTags, thumbnailSource } from "@/lib/preview/preview";
import { ExpandIcon, ExternalIcon, FileTypeIcon } from "../ui/icons";
import { Spinner } from "../ui/ui";
import {
  InlineFrame,
  Loading,
  Unavailable,
  overlayTextButton,
  useImageStatus,
  useLoad,
  type ViewProps,
} from "./chrome";

export function ImageView({ code, file, url, inline, onExpand }: ViewProps) {
  const { status, setStatus, ref: imageRef } = useImageStatus();
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

  if (status === "failed")
    return (
      <Unavailable
        code={code}
        file={file}
        url={url}
        inline={inline}
        message="This image format can't be shown in the browser"
      />
    );

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
      ref={imageRef}
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
    <div
      ref={scroller}
      className={`absolute inset-0 ${zoom ? "overflow-auto overscroll-contain" : "flex touch-pan-y items-center justify-center p-2 sm:px-16 sm:pb-6"}`}
    >
      {status === "loading" && <Loading inline={false} />}
      {zoom ? (
        <div className="grid size-max min-h-full min-w-full place-items-center">
          {image("max-w-none cursor-zoom-out", toggleZoom)}
        </div>
      ) : (
        image(`max-h-full max-w-full object-contain ${zoomable ? "cursor-zoom-in" : ""}`, toggleZoom)
      )}
    </div>
  );
}

export function VideoView({ code, file, url, inline }: ViewProps) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <Unavailable
        code={code}
        file={file}
        url={url}
        inline={inline}
        message="This video format can't be played in the browser"
      />
    );
  if (inline) {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="max-h-[60vh] w-full rounded-xl bg-black"
      />
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center sm:px-16 sm:pb-6">
      <video
        src={url}
        controls
        autoPlay
        playsInline
        onError={() => setFailed(true)}
        className="max-h-full max-w-full"
      />
    </div>
  );
}

// Stands in for `loadKnownTags` where the server can't read the file's tags, so nothing is fetched.
const noTags = (): Promise<AudioTags> => Promise.reject(new Error("No tags to read"));

/**
 * Cover art. Until the tags say whether there is any, only a quiet placeholder shows; the
 * file-type icon is for a track that has none.
 */
function Artwork({
  src,
  pending,
  path,
  className,
  placeholder,
  iconClassName,
}: {
  src?: string;
  pending: boolean;
  path: string;
  className: string;
  placeholder: string;
  iconClassName: string;
}) {
  const { status, ref: imageRef, onLoad, onError } = useImageStatus();
  const bare = !pending && (!src || status === "failed");
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${bare ? "bg-accent-solid text-accent-fg" : placeholder} ${className}`}
    >
      {bare && <FileTypeIcon path={path} className={iconClassName} />}
      {src && status !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
        <img
          ref={imageRef}
          src={src}
          alt=""
          onLoad={onLoad}
          onError={onError}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

/** The cover, blurred to tint the viewer behind it; faded in rather than cut in. */
function Backdrop({ src }: { src: string }) {
  const { status, ref: imageRef, onLoad, onError } = useImageStatus();
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
    <img
      ref={imageRef}
      src={src}
      alt=""
      aria-hidden
      onLoad={onLoad}
      onError={onError}
      className={`pointer-events-none fixed inset-0 size-full scale-110 object-cover blur-3xl transition-opacity duration-500 ${status === "ready" ? "opacity-30" : "opacity-0"}`}
    />
  );
}

export function AudioView({ code, file, url, inline }: ViewProps) {
  const [failed, setFailed] = useState(false);
  const tagged = hasTags(file);
  const source = tagsUrl(code, file.idx);
  const loaded = useLoad(source, tagged ? loadKnownTags : noTags);
  // Tags the viewer fetched ahead, for the track after this one, are there on the first render.
  const tags = loaded.data ?? knownTags(source);
  const pending = tagged && !tags && !loaded.failed;
  if (failed)
    return (
      <Unavailable
        code={code}
        file={file}
        url={url}
        inline={inline}
        message="This audio format can't be played in the browser"
      />
    );
  const player = (
    <audio
      src={url}
      controls
      autoPlay={!inline}
      preload="metadata"
      onError={() => setFailed(true)}
      className="w-full"
    />
  );
  const title = tags?.title ?? basename(file.path);
  const byline = [tags?.artist, tags?.album].filter(Boolean).join(" · ");
  const cover = tags?.cover ? renderUrl(code, file.idx) : undefined;

  if (inline) {
    // The same card from the start, so the player in it isn't replaced, and stopped, once the tags come.
    if (!tagged) return player;
    return (
      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="mb-3 flex items-center gap-3">
          <Artwork
            src={cover}
            pending={pending}
            path={file.path}
            className="size-14 rounded-lg"
            placeholder="bg-hover"
            iconClassName="size-6"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}</p>
            {byline && <p className="truncate text-sm text-muted">{byline}</p>}
          </div>
        </div>
        {player}
      </div>
    );
  }

  const details = tags ? audioDetails(tags) : [];
  return (
    <div className="absolute inset-0 touch-pan-y overflow-y-auto overscroll-contain">
      {cover && <Backdrop src={cover} />}
      <div className="relative flex min-h-full items-center justify-center p-6">
        {/* Shown whole once the tags are in, rather than laid out twice as they arrive. A track
            the viewer fetched ahead has them from the start and never fades. */}
        <div
          className={`flex w-full max-w-md flex-col items-center text-center ${pending ? "opacity-0" : "opacity-100 transition-opacity duration-200"}`}
        >
          <Artwork
            src={cover}
            pending={pending}
            path={file.path}
            className="size-48 rounded-3xl shadow-2xl shadow-black/50 sm:size-64"
            placeholder="bg-white/10"
            iconClassName="size-16"
          />
          <p className="mt-6 w-full truncate text-lg font-semibold">{title}</p>
          {/* Held open while the tags come, so the player below doesn't jump when they do. */}
          <p className="w-full truncate text-sm text-white/70">{byline || " "}</p>
          <div className="mt-6 w-full">{player}</div>
          {details.length > 0 && (
            <dl className="mt-6 grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl bg-white/5 p-4 text-left text-sm">
              {details.map(([label, value]) => (
                <Fragment key={label}>
                  <dt className="text-white/50">{label}</dt>
                  <dd className="min-w-0 truncate tabular-nums">{value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
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
  const frame = (
    <iframe src={`${src}#navpanes=0&view=FitH`} title={basename(file.path)} className="size-full border-0 bg-white" />
  );
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
