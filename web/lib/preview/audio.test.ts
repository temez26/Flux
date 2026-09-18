import assert from "node:assert/strict";
import { test } from "vitest";
import type { AudioTags } from "../api";
import { audioDetails, audioQuality, formatPlaytime } from "./audio";

test("shows a running time the way a player does", () => {
  assert.equal(formatPlaytime(7), "0:07");
  assert.equal(formatPlaytime(187.4), "3:07");
  assert.equal(formatPlaytime(3723), "1:02:03");
});

test("describes the encoding in listener's terms", () => {
  const tags: AudioTags = { duration: 1, cover: false, sampleRate: 44_100, bitDepth: 16, channels: 2, bitrate: 320 };
  // Numbers are written the reader's way, so only the rest is fixed.
  assert.equal(audioQuality(tags), `${(44.1).toLocaleString()} kHz · 16-bit · Stereo · 320 kbps`);
  assert.equal(audioQuality({ duration: 1, cover: false, channels: 6 }), "6 channels");
});

test("lists only what the file says", () => {
  const details = audioDetails({
    duration: 187,
    cover: true,
    artist: "Band",
    albumArtist: "Band",
    track: 3,
    trackTotal: 12,
    disc: 1,
    genre: "Jazz",
  });
  assert.deepEqual(details, [
    ["Track", "3 of 12"],
    ["Disc", "1"],
    ["Genre", "Jazz"],
    ["Length", "3:07"],
  ]);
});

test("names the album artist only where it differs from the track's", () => {
  const details = audioDetails({ duration: 0, cover: false, artist: "Band", albumArtist: "Various Artists" });
  assert.deepEqual(details, [["Album artist", "Various Artists"]]);
});
