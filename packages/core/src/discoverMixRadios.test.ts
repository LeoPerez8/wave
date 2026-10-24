import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { discoverMixesOfRadios, mixKnownSongs, type DiscoverMix } from "./index.ts";

const yt = (videoId: string, artist = "Someone New", title = `Song ${videoId}`) => ({
  videoId,
  title,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
  video: false,
});
/** Radio songs [from]…[to] (video ids `${prefix}${n}`). */
const run = (prefix: string, from: number, to: number, artist?: string) =>
  Array.from({ length: to - from + 1 }, (_, n) => yt(`${prefix}${from + n}`, artist));

const seed = (name: string) => ({
  kind: "artist" as const,
  id: `artist:${name.toLowerCase()}`,
  name,
  from: "plays" as const,
});
const portishead = seed("Portishead");
const tricky = seed("Tricky");

const artists = [
  { id: 1, name: "Portishead" },
  { id: 2, name: "Tricky" },
];
const gloryBox = {
  id: 10,
  title: "Glory Box",
  artist: "Portishead",
  artistIds: [1],
  durationMs: 200_000,
  addedAt: 1,
};
const library = { artists, songs: [gloryBox] };
const known = mixKnownSongs({
  library: library.songs,
  playedRecordingKeys: [],
  streamed: [],
  playlisted: [],
});

const videos = (mix: DiscoverMix | undefined) => mix?.songs.map((song) => song.videoId);
const familiarIds = (mix: DiscoverMix | undefined) =>
  mix?.familiar?.map((song) => (song.source === "library" ? song.track.id : song.song.videoId));

describe("Mixes from radios read at once", () => {
  test("a new song both radios found stays in the earlier seed's mix", () => {
    const mixes = discoverMixesOfRadios(
      [
        { seed: portishead, radio: run("p", 1, 12) },
        { seed: tricky, radio: [yt("p3"), yt("p7"), ...run("t", 1, 10)] },
      ],
      { known, library },
    );
    assert.deepEqual(
      mixes.map((mix) => mix.id),
      ["artist:portishead", "artist:tricky"],
    );
    assert.deepEqual(videos(mixes[0]), [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
      "p11",
      "p12",
    ]);
    assert.deepEqual(videos(mixes[1]), [
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
      "t9",
      "t10",
    ]);
  });

  test("a familiar song both radios played is in the earlier seed's share only", () => {
    const heard = yt("gb", "Portishead", "Glory Box");
    const mixes = discoverMixesOfRadios(
      [
        { seed: tricky, radio: [heard, ...run("t", 1, 10)] },
        { seed: portishead, radio: [heard, ...run("p", 1, 10)] },
      ],
      { known, library },
    );
    assert.deepEqual(familiarIds(mixes[0]), [10]);
    assert.deepEqual(familiarIds(mixes[1]), []);
  });

  test("a seed left with fewer than ten new songs makes no mix and takes none from the next", () => {
    const mixes = discoverMixesOfRadios(
      [
        { seed: portishead, radio: run("p", 1, 12) },
        { seed: tricky, radio: [...run("p", 1, 6), ...run("t", 1, 3)] },
        { seed: seed("Massive Attack"), radio: [...run("t", 1, 3), ...run("m", 1, 7)] },
      ],
      { known, library },
    );
    assert.deepEqual(
      mixes.map((mix) => mix.id),
      ["artist:portishead", "artist:massive attack"],
    );
    assert.deepEqual(videos(mixes[1]), [
      "t1",
      "t2",
      "t3",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
    ]);
  });
});
