import type { AudioTags } from "../api";

/** A running time as a player shows it, e.g. "3:07" or "1:02:03". */
export function formatPlaytime(seconds: number): string {
  const s = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const position = (n?: number | null, total?: number | null) =>
  n ? (total ? `${n} of ${total}` : String(n)) : undefined;

const CHANNELS: Record<number, string> = { 1: "Mono", 2: "Stereo" };

/** How the audio is encoded, in the terms a listener would compare two files by. */
export function audioQuality(tags: AudioTags): string {
  const parts = [
    tags.sampleRate && `${(tags.sampleRate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`,
    tags.bitDepth && `${tags.bitDepth}-bit`,
    tags.channels && (CHANNELS[tags.channels] ?? `${tags.channels} channels`),
    tags.bitrate && `${tags.bitrate.toLocaleString()} kbps`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The tags worth listing beneath a track's title, artist and album, leaving out what it doesn't say. */
export function audioDetails(tags: AudioTags): [label: string, value: string][] {
  const rows: [string, string | null | undefined][] = [
    // Only worth a line where it says something the artist doesn't, as on a compilation.
    ["Album artist", tags.albumArtist !== tags.artist ? tags.albumArtist : undefined],
    ["Year", tags.year ? String(tags.year) : undefined],
    ["Track", position(tags.track, tags.trackTotal)],
    ["Disc", position(tags.disc, tags.discTotal)],
    ["Genre", tags.genre],
    ["Length", tags.duration > 0 ? formatPlaytime(tags.duration) : undefined],
    ["Quality", audioQuality(tags) || undefined],
  ];
  return rows.filter((row): row is [string, string] => !!row[1]);
}
