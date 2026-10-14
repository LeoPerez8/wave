import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pagePlayback, type MixedSong, type YtSong } from "./index.ts";

interface Track {
  readonly id: number;
}

const ytSong = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: [],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const library = (id: number): MixedSong<YtSong, Track> => ({ source: "library", track: { id } });
const stream = (videoId: string): MixedSong<YtSong, Track> => ({
  source: "stream",
  song: ytSong(videoId),
});

describe("pagePlayback", () => {
  test("a page with only the Library's songs plays the Library's tracks", () => {
    assert.deepEqual(pagePlayback([library(3), library(1), library(2)]), {
      kind: "library",
      tracks: [{ id: 3 }, { id: 1 }, { id: 2 }],
    });
  });

  test("a page with YouTube Music's songs among the Library's plays the mixed list, in page order", () => {
    const songs = [library(3), stream("a"), library(1), stream("b")];
    assert.deepEqual(pagePlayback(songs), { kind: "mixed", songs });
  });
});
