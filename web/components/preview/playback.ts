"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Past this far into a track, Previous starts it again rather than going back a track. */
const RESTART_AFTER_S = 3;

/** The state of a hidden <audio> element, and what the controls drawn in its place do to it. */
export function usePlayback() {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const media = useCallback(() => audio.current, []);

  // A refused play (no gesture yet to allow sound) just leaves the Play button showing.
  const play = useCallback(() => {
    audio.current?.play().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (audio.current?.paused) play();
    else audio.current?.pause();
  }, [play]);

  const seek = useCallback((seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds;
  }, []);

  const changeVolume = useCallback((value: number) => {
    const el = audio.current;
    if (!el) return;
    el.muted = false;
    el.volume = value;
  }, []);

  const readDuration = (el: HTMLAudioElement) => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
  const element = {
    ref: audio,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onLoadedMetadata: (e: { currentTarget: HTMLAudioElement }) => readDuration(e.currentTarget),
    onDurationChange: (e: { currentTarget: HTMLAudioElement }) => readDuration(e.currentTarget),
    onVolumeChange: (e: { currentTarget: HTMLAudioElement }) =>
      setVolume(e.currentTarget.muted ? 0 : e.currentTarget.volume),
  };

  return { element, media, playing, duration, volume, play, toggle, seek, changeVolume };
}

export type Playback = ReturnType<typeof usePlayback>;

/** Previous as a music player does it: back to the start first, and only then a track back. */
export function usePrevious({ media, seek }: Playback, onPrevious?: () => void) {
  return useCallback(() => {
    if ((media()?.currentTime ?? 0) > RESTART_AFTER_S || !onPrevious) seek(0);
    else onPrevious();
  }, [media, seek, onPrevious]);
}

/** Names what is playing to the system, for the lock screen, notification and media keys. */
export function useMediaSession(
  playback: Playback,
  track: { title: string; artist?: string | null; album?: string | null; cover?: string },
  previous: () => void,
  onNext?: () => void,
) {
  const { media, play, seek } = playback;
  const { title, artist, album, cover } = track;
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
      ["play", play],
      ["pause", () => media()?.pause()],
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
  }, [title, artist, album, cover, media, play, seek, previous, onNext]);
}
