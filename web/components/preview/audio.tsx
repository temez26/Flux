"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { loadTags, renderUrl, tagsUrl, type AudioTags } from "@/lib/api";
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
import { Unavailable, useLoad, type Status, type ViewProps } from "./chrome";

// Stands in for `loadTags` where the server can't read the file's tags, so nothing is fetched.
const noTags = (): Promise<AudioTags> => Promise.reject(new Error("No tags to read"));

/** Past this far into a track, Previous starts it again rather than going back a track. */
const RESTART_AFTER_S = 3;
/** How far an arrow key moves the playhead. */
const ARROW_SEEK_S = 5;

/** The state of a hidden <audio> element, and what the controls drawn in its place do to it. */
function usePlayback() {
  const audio = useRef<HTMLAudioElement>(null);
  const scrubbing = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  // `timeupdate` comes a few times a second, which makes the bar step; frames keep it gliding.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      if (audio.current && !scrubbing.current) setTime(audio.current.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = seconds;
    setTime(seconds);
  }, []);

  const changeVolume = useCallback((value: number) => {
    const el = audio.current;
    if (!el) return;
    el.muted = false;
    el.volume = value;
  }, []);

  const position = useCallback(() => audio.current?.currentTime ?? 0, []);
  // While the bar is held, the frames must not pull it back to where playback is.
  const startScrub = useCallback(() => void (scrubbing.current = true), []);
  const endScrub = useCallback(() => void (scrubbing.current = false), []);

  const readDuration = (el: HTMLAudioElement) => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
  const element = {
    ref: audio,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onLoadedMetadata: (e: { currentTarget: HTMLAudioElement }) => readDuration(e.currentTarget),
    onDurationChange: (e: { currentTarget: HTMLAudioElement }) => readDuration(e.currentTarget),
    // Covers seeks while paused, when no frames are running.
    onTimeUpdate: (e: { currentTarget: HTMLAudioElement }) => scrubbing.current || setTime(e.currentTarget.currentTime),
    onVolumeChange: (e: { currentTarget: HTMLAudioElement }) =>
      setVolume(e.currentTarget.muted ? 0 : e.currentTarget.volume),
  };

  return {
    element,
    playing,
    time,
    duration,
    volume,
    toggle,
    seek,
    position,
    startScrub,
    endScrub,
    changeVolume,
  };
}

type Playback = ReturnType<typeof usePlayback>;

/** Previous as a music player does it: back to the start first, and only then a track back. */
function usePrevious({ position, seek }: Playback, onPrevious?: () => void) {
  return useCallback(() => {
    if (position() > RESTART_AFTER_S || !onPrevious) seek(0);
    else onPrevious();
  }, [position, seek, onPrevious]);
}

/** Names what is playing to the system, for the lock screen, notification and media keys. */
function useMediaSession(
  playback: Playback,
  track: { title: string; artist?: string | null; album?: string | null; cover?: string },
  previous: () => void,
  onNext?: () => void,
) {
  const { playing, toggle, seek } = playback;
  const { title, artist, album, cover } = track;
  // Read by the handlers when they run, so they needn't be registered again on every change.
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title,
      artist: artist ?? "",
      album: album ?? "",
      artwork: cover ? [{ src: new URL(cover, location.href).href }] : [],
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => playingRef.current || toggle()],
      ["pause", () => playingRef.current && toggle()],
      ["seekto", (details) => details.seekTime !== undefined && seek(details.seekTime)],
      ["previoustrack", previous],
      ["nexttrack", onNext ?? null],
    ];
    const set = (handler: (action: MediaSessionAction) => MediaSessionActionHandler | null) => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, handler(action));
        } catch {
          // An action this browser doesn't know.
        }
      }
    };
    set((action) => handlers.find(([a]) => a === action)?.[1] ?? null);
    return () => {
      session.metadata = null;
      set(() => null);
    };
  }, [title, artist, album, cover, toggle, seek, previous, onNext]);
}

function Timeline({ playback, length, className = "" }: { playback: Playback; length: number; className?: string }) {
  const { time, seek, startScrub, endScrub } = playback;
  const at = Math.min(time, length);
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const step = {
      ArrowRight: ARROW_SEEK_S,
      ArrowUp: ARROW_SEEK_S,
      ArrowLeft: -ARROW_SEEK_S,
      ArrowDown: -ARROW_SEEK_S,
    }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    seek(Math.max(0, Math.min(length, at + step)));
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
        onPointerDown={startScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onChange={(e) => seek(Number(e.target.value))}
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

/** Cover art over the file-type icon, which shows until the art loads and stays if there is none. */
function Artwork({
  src,
  path,
  className,
  iconClassName,
}: {
  src?: string;
  path: string;
  className: string;
  iconClassName: string;
}) {
  const [status, setStatus] = useState<Status>("loading");
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-accent-solid text-accent-fg ${className}`}
    >
      <FileTypeIcon path={path} className={iconClassName} />
      {src && status !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
        <img
          src={src}
          alt=""
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("failed")}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

interface Track {
  title: string;
  byline: string;
  cover?: string;
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
      {track.cover && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
        <img
          src={track.cover}
          alt=""
          aria-hidden
          className="pointer-events-none fixed inset-0 size-full scale-110 object-cover opacity-40 blur-3xl"
        />
      )}
      <div className="relative flex min-h-full items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          {/* Sits back while paused and steps forward to play, as the cover does in a music app. */}
          <div
            className={`transition-transform duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] ${playing ? "scale-100" : "scale-[0.86]"}`}
          >
            <Artwork
              src={track.cover}
              path={file.path}
              className={`aspect-square w-full rounded-2xl transition-shadow duration-500 ${playing ? "shadow-2xl shadow-black/60" : "shadow-lg shadow-black/40"}`}
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
        <Artwork src={track.cover} path={view.file.path} className="size-14 rounded-lg" iconClassName="size-6" />
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
  const { data: tags } = useLoad(tagsUrl(code, file.idx), hasTags(file) ? loadTags : noTags);
  const playback = usePlayback();
  const cover = tags?.cover ? renderUrl(code, file.idx) : undefined;
  const track: Track = {
    title: tags?.title ?? basename(file.path),
    byline: [tags?.artist, tags?.album].filter(Boolean).join(" — "),
    cover,
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
