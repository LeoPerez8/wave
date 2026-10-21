import assert from "node:assert/strict";
import { test } from "node:test";

import { libraryFinder, playingTrackIds, type YtSong } from "./index.ts";

const song: YtSong = {
  videoId: "current",
  title: "The song",
  artists: ["The artist"],
  album: "Album",
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
};
const downloaded = { id: 42, title: "The song", artist: "The artist", durationMs: 180000 };

test("a playing stream keeps both its online and Library rows marked when its download arrives", () => {
  assert.deepEqual(playingTrackIds("yt:current", song, libraryFinder([])), ["yt:current"]);
  assert.deepEqual(playingTrackIds("yt:current", song, libraryFinder([downloaded])), [
    "yt:current",
    "42",
  ]);
});

test("skipping or stopping clears the previous recording's Library highlight even with stale metadata", () => {
  const find = libraryFinder([downloaded]);
  assert.deepEqual(playingTrackIds("yt:next", song, find), ["yt:next"]);
  assert.deepEqual(playingTrackIds("7", song, find), ["7"]);
  assert.deepEqual(playingTrackIds(null, song, find), []);
  assert.deepEqual(
    playingTrackIds(
      "yt:current",
      song,
      libraryFinder([{ ...downloaded, artist: "Another artist" }]),
    ),
    ["yt:current"],
  );
});
