import assert from "node:assert/strict";
import { test } from "node:test";

import { MIX_PRE_DOWNLOAD_SONGS, mixPreDownload } from "./index.ts";
import type { BlendedDiscoverMix, DiscoverMixSong, YtAlbumSong } from "./index.ts";

const song = (videoId: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Portishead"],
  album: "Dummy",
  albumId: "MPREb_dummy",
  durationMs: 200_000,
  artworkUrl: "https://example.com/dummy.jpg",
  explicit: false,
});

const stream = (videoId: string): DiscoverMixSong => ({ source: "stream", song: song(videoId) });

const library = (id: number): DiscoverMixSong => ({
  source: "library",
  track: { id, title: `Track ${id}`, artist: "Portishead" },
});

const mix = (name: string, songs: readonly DiscoverMixSong[]): BlendedDiscoverMix => ({
  id: `artist:${name}`,
  seed: { kind: "artist", name },
  songs,
});

test("the first five songs that stream in each mix are fetched, the mixes taking turns", () => {
  const artistMixes = [
    mix("a", [
      stream("a1"),
      library(1),
      stream("a2"),
      stream("a3"),
      stream("a4"),
      stream("a5"),
      stream("a6"),
    ]),
    mix("b", [stream("b1"), stream("b2")]),
  ];
  const genreMixes = [mix("c", [library(2), stream("c1"), stream("c2"), stream("c3")])];
  assert.deepEqual(mixPreDownload([artistMixes, genreMixes]), [
    "a1",
    "b1",
    "c1",
    "a2",
    "b2",
    "c2",
    "a3",
    "c3",
    "a4",
    "a5",
  ]);
  assert.equal(MIX_PRE_DOWNLOAD_SONGS, 5);
});

test("a song in an artist mix and a genre mix is fetched once, at its first turn", () => {
  const artistMixes = [mix("a", [stream("a1"), stream("x")])];
  const genreMixes = [mix("c", [stream("x"), stream("c2")])];
  assert.deepEqual(mixPreDownload([artistMixes, genreMixes]), ["a1", "x", "c2"]);
  assert.deepEqual(mixPreDownload([]), []);
});
