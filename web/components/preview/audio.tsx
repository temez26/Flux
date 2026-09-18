"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { loadTags, renderUrl, tagsUrl, thumbUrl, type AudioTags } from "@/lib/api";
import { basename } from "@/lib/platform/files";
import { audioDetails, formatPlaytime } from "@/lib/preview/audio";
import { hasTags } from "@/lib/preview/preview";
import {
  FileTypeIcon,
  NextIcon,
  PauseFillIcon,
  PlayFillIcon,
  PreviousIcon,
  VolumeHighIcon,
  VolumeLowIcon,
} from "../ui/icons";
import { Unavailable, useLoad, type ViewProps } from "./chrome";
import { useMediaSession, usePlayback, usePrevious, type Playback } from "./playback";

/** How far an arrow key moves the playhead. */
const ARROW_SEEK_S = 5;

// A file's tags don't change, and stepping back and forth through an album asks for the same
// ones again, so each is fetched once.
const knownTags = new Map<string, AudioTags>();

async function loadKnownTags(url: string, signal: AbortSignal): Promise<AudioTags> {
  const known = knownTags.get(url);
  if (known) return known;
  const tags = await loadTags(url, signal);
  knownTags.set(url, tags);
  return tags;
}

// Stands in where the server can't read the file's tags, so nothing is fetched.
const noTags = (): Promise<AudioTags> => Promise.reject(new Error("No tags to read"));

/**
 * The playhead. It keeps the position to itself, so following playback frame by frame redraws
 * this bar and not the screen around it. A drag moves only the bar; playback jumps once it is
 * let go, rather than fetching the file afresh at every point it passes.
 */
function Timeline({ playback, length, className = "" }: { playback: Playback; length: number; className?: string }) {
  const { media, playing, seek } = playback;
  const [time, setTime] = useState(0);
  const [dragged, setDragged] = useState<number | null>(null);
  const dragging = useRef(false);

  // Frames while playing, so the bar glides instead of stepping with each `timeupdate`; the
  // events cover seeks while paused.
  useEffect(() => {
    const el = media();
    if (!el) return;
    const update = () => setTime(el.currentTime);
    let frame = 0;
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    if (playing) frame = requestAnimationFrame(tick);
    el.addEventListener("timeupdate", update);
    el.addEventListener("seeked", update);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("timeupdate", update);
      el.removeEventListener("seeked", update);
    };
  }, [media, playing]);

  const at = Math.min(dragged ?? time, length);

  function jump(seconds: number) {
    setTime(seconds);
    seek(seconds);
  }

  function hold(e: PointerEvent<HTMLInputElement>) {
    dragging.current = true;
    // Its release still comes here when the pointer has wandered off the bar.
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function release() {
    dragging.current = false;
    if (dragged !== null) jump(dragged);
    setDragged(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const step = {
      ArrowRight: ARROW_SEEK_S,
      ArrowUp: ARROW_SEEK_S,
      ArrowLeft: -ARROW_SEEK_S,
      ArrowDown: -ARROW_SEEK_S,
    }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    jump(Math.max(0, Math.min(length, at + step)));
  }

  return (
    <div className={className}>
      <input
        type="range"
        className="scrubber"
        aria-label="Position"
        aria-valuetext={`${formatPlaytime(at)} of ${formatPlaytime(length)}`}
        min={0}
        max={length || 1}
        step="any"
        value={at}
        disabled={!length}
        style={{ "--value": `${length ? (at / length) * 100 : 0}%` } as CSSProperties}
        onPointerDown={hold}
        onPointerUp={release}
        onPointerCancel={release}
        onChange={(e) => (dragging.current ? setDragged(Number(e.target.value)) : jump(Number(e.target.value)))}
        onKeyDown={onKeyDown}
      />
      <div className="mt-1 flex justify-between text-xs font-medium tabular-nums opacity-60">
        <span>{formatPlaytime(at)}</span>
        <span>-{formatPlaytime(Math.max(0, length - at))}</span>
      </div>
    </div>
  );
}

const transportButton =
  "flex items-center justify-center rounded-full p-2 transition hover:bg-white/10 active:scale-90 disabled:pointer-events-none disabled:opacity-30";

function Transport({ playback, previous, onNext }: { playback: Playback; previous: () => void; onNext?: () => void }) {
  const { playing, toggle } = playback;
  return (
    <div className="flex items-center justify-center gap-8 sm:gap-12">
      <button type="button" aria-label="Previous" title="Previous" onClick={previous} className={transportButton}>
        <PreviousIcon className="size-9" />
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
        onClick={toggle}
        className={`${transportButton} p-3`}
      >
        {playing ? <PauseFillIcon className="size-12" /> : <PlayFillIcon className="size-12" />}
      </button>
      <button
        type="button"
        aria-label="Next"
        title="Next"
        onClick={onNext}
        disabled={!onNext}
        className={transportButton}
      >
        <NextIcon className="size-9" />
      </button>
    </div>
  );
}

/**
 * An image that fades in once it loads, or shows at once when the browser already has it, as
 * a cover does when stepping to the next track of the same album.
 */
function CoverImage({ src, className, onFailed }: { src: string; className: string; onFailed?: () => void }) {
  const [shown, setShown] = useState<"no" | "fade" | "now">("no");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
    <img
      src={src}
      alt=""
      // Checked before the first paint, so a cached image is never drawn hidden first.
      ref={(img) => {
        if (img?.complete && img.naturalWidth) setShown((s) => (s === "no" ? "now" : s));
      }}
      onLoad={() => setShown((s) => (s === "no" ? "fade" : s))}
      onError={onFailed}
      className={`${className} ${shown === "no" ? "opacity-0" : "opacity-100"} ${shown === "fade" ? "transition-opacity duration-300" : ""}`}
    />
  );
}

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
  const [failed, setFailed] = useState(false);
  const bare = !pending && (!src || failed);
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${bare ? "bg-accent-solid text-accent-fg" : placeholder} ${className}`}
    >
      {bare && <FileTypeIcon path={path} className={iconClassName} />}
      {src && !failed && (
        <CoverImage src={src} className="absolute inset-0 size-full object-cover" onFailed={() => setFailed(true)} />
      )}
    </span>
  );
}

interface Track {
  title: string;
  byline: string;
  cover?: string;
  /** The small rendering of the cover: plenty for a backdrop that is blurred beyond recognition. */
  backdrop?: string;
  /** The tags are still on their way, so whether there is cover art isn't known yet. */
  pending: boolean;
  length: number;
}

/** The viewer's now-playing screen, laid out the way a music app shows the track it plays. */
function NowPlaying({
  view,
  track,
  tags,
  playback,
  previous,
}: {
  view: ViewProps;
  track: Track;
  tags?: AudioTags;
  playback: Playback;
  previous: () => void;
}) {
  const { file, onNext } = view;
  const { playing, toggle, volume, changeVolume } = playback;
  const details = tags ? audioDetails(tags) : [];

  // Space plays and pauses, as in any player, unless something else on screen wants it.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== " " || e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="absolute inset-0 touch-pan-y overflow-y-auto overscroll-contain [--played:rgb(255_255_255/0.9)] [--rest:rgb(255_255_255/0.2)]">
      {track.backdrop && (
        // A layer of its own, blurred once, so nothing that moves above it makes it blur again.
        <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden opacity-40 will-change-transform">
          <CoverImage src={track.backdrop} className="size-full scale-110 object-cover blur-3xl" />
        </div>
      )}
      <div className="relative flex min-h-full items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          {/* Sits back while paused and steps forward to play, as the cover does in a music app. */}
          <div
            className={`transition-transform duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] ${playing ? "scale-100" : "scale-[0.86]"}`}
          >
            <Artwork
              src={track.cover}
              pending={track.pending}
              path={file.path}
              className={`aspect-square w-full rounded-2xl transition-shadow duration-500 ${playing ? "shadow-2xl shadow-black/60" : "shadow-lg shadow-black/40"}`}
              placeholder="bg-white/10"
              iconClassName="size-20"
            />
          </div>
          <div className="mt-8">
            <p className="truncate text-xl font-semibold">{track.title}</p>
            <p className="truncate text-white/60">{track.byline || " "}</p>
          </div>
          {/* Dragging these must not also swipe to the next file. */}
          <div onPointerDown={(e) => e.stopPropagation()}>
            <Timeline playback={playback} length={track.length} className="mt-5" />
            <div className="mt-4">
              <Transport playback={playback} previous={previous} onNext={onNext} />
            </div>
            {/* Phones set the volume with their own buttons, and iOS ignores it from a page. */}
            <div className="mt-6 flex items-center gap-3 text-white/60 pointer-coarse:hidden">
              <VolumeLowIcon className="size-4 shrink-0" />
              <input
                type="range"
                className="scrubber"
                aria-label="Volume"
                min={0}
                max={1}
                step="any"
                value={volume}
                style={{ "--value": `${volume * 100}%` } as CSSProperties}
                onChange={(e) => changeVolume(Number(e.target.value))}
              />
              <VolumeHighIcon className="size-4 shrink-0" />
            </div>
          </div>
          {details.length > 0 && (
            <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-white/10 pt-4 text-sm">
              {details.map(([label, value]) => (
                <Fragment key={label}>
                  <dt className="text-white/50">{label}</dt>
                  <dd className="min-w-0 truncate text-white/80 tabular-nums">{value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

/** The single file on a transfer's page: a compact player in the page's own colours. */
function InlinePlayer({ view, track, playback }: { view: ViewProps; track: Track; playback: Playback }) {
  const { playing, toggle } = playback;
  return (
    <div className="rounded-xl border border-line bg-bg p-3 [--played:var(--fg)] [--rest:var(--line)]">
      <div className="flex items-center gap-3">
        <Artwork
          src={track.cover}
          pending={track.pending}
          path={view.file.path}
          className="size-14 rounded-lg"
          placeholder="bg-hover"
          iconClassName="size-6"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{track.title}</p>
          {track.byline && <p className="truncate text-sm text-muted">{track.byline}</p>}
        </div>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={toggle}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-solid text-accent-fg transition hover:brightness-110 active:scale-90"
        >
          {playing ? <PauseFillIcon className="size-5" /> : <PlayFillIcon className="ml-0.5 size-5" />}
        </button>
      </div>
      <Timeline playback={playback} length={track.length} className="mt-3" />
    </div>
  );
}

export function AudioView(view: ViewProps) {
  const { code, file, url, inline, onNext, nextIsAudio } = view;
  const [failed, setFailed] = useState(false);
  const tagged = hasTags(file);
  const { data: tags, failed: untagged } = useLoad(tagsUrl(code, file.idx), tagged ? loadKnownTags : noTags);
  const playback = usePlayback();
  const cover = tags?.cover ? renderUrl(code, file.idx) : undefined;
  const track: Track = {
    title: tags?.title ?? basename(file.path),
    byline: [tags?.artist, tags?.album].filter(Boolean).join(" — "),
    cover,
    backdrop: tags?.cover ? thumbUrl(code, file.idx) : undefined,
    pending: tagged && !tags && !untagged,
    // Some formats only tell the browser their length once played through; the tags know it.
    length: playback.duration || tags?.duration || 0,
  };
  const previous = usePrevious(playback, view.onPrevious);
  useMediaSession(playback, { title: track.title, artist: tags?.artist, album: tags?.album, cover }, previous, onNext);

  if (failed) return <Unavailable {...view} message="This audio format can't be played in the browser" />;
  return (
    <>
      <audio
        {...playback.element}
        src={url}
        preload="metadata"
        autoPlay={!inline}
        // An album plays on into its next track; anything else stops at the end.
        onEnded={() => nextIsAudio && onNext?.()}
        onError={() => setFailed(true)}
      />
      {inline ? (
        <InlinePlayer view={view} track={track} playback={playback} />
      ) : (
        <NowPlaying view={view} track={track} tags={tags} playback={playback} previous={previous} />
      )}
    </>
  );
}
