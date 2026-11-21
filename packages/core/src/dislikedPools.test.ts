import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  blendDiscoverMix,
  discoverMixKeep,
  magicArtistKey,
  randomMagicQueuePicks,
  rankRadioSongs,
  type DiscoverMix,
  type YtAlbumSong,
} from "./index.ts";

const song = (videoId: string, artist = videoId): YtAlbumSong => ({
  videoId,
  title: videoId,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
});

const libraryTrack = (id: number, artist: string) => ({
  trackId: String(id),
  artists: [magicArtistKey(artist)],
  genre: null,
  style: null,
});

describe("a disliked song stays out of what Wave picks on its own", () => {
  const page = { id: "song:seed", artists: ["Seed"], songs: [song("first"), song("second")] };

  test("a ranked radio (a Magic Queue batch, a mix's build) leaves out a disliked video", () => {
    const ranked = rankRadioSongs(
      { artists: ["Seed"] },
      { pages: [page], disliked: new Set(["yt:first"]) },
    );
    assert.deepEqual(
      ranked.map(({ trackId }) => trackId),
      ["yt:second"],
    );
  });

  test("a ranked radio leaves out a disliked Library song, from the radio or the Library", () => {
    const ranked = rankRadioSongs(
      { artists: ["Seed"] },
      {
        pages: [page],
        library: [libraryTrack(7, "Seed"), libraryTrack(8, "Seed")],
        inLibrary: (radio) => (radio.videoId === "first" ? libraryTrack(5, "first") : null),
        disliked: new Set(["5", "7"]),
      },
    );
    assert.deepEqual(
      ranked.map(({ trackId }) => trackId),
      ["yt:second", "8"],
    );
  });

  test("a radio song the Library has is out when its video was the one disliked", () => {
    const ranked = rankRadioSongs(
      { artists: ["Seed"] },
      {
        pages: [page],
        inLibrary: (radio) => (radio.videoId === "first" ? libraryTrack(5, "first") : null),
        disliked: new Set(["yt:first"]),
      },
    );
    assert.deepEqual(
      ranked.map(({ trackId }) => trackId),
      ["yt:second"],
    );
  });

  test("a saved mix stops playing a song disliked since its build, new or familiar", () => {
    const mix: DiscoverMix = {
      id: "artist:1",
      seed: { kind: "artist", name: "Seed" },
      songs: [song("new1"), song("new2")],
      familiar: [
        { source: "library", track: { id: 7, title: "Seven", artist: "Seed" } },
        { source: "library", track: { id: 8, title: "Eight", artist: "Seed" } },
        { source: "stream", song: song("known") },
      ],
    };
    const keep = discoverMixKeep({
      dontPlayExplicit: false,
      library: null,
      disliked: new Set(["yt:new1", "7", "yt:known"]),
    });
    const blended = blendDiscoverMix(mix, { level: 3, keep });
    assert.deepEqual(
      blended.songs.map((entry) =>
        entry.source === "stream" ? entry.song.videoId : entry.track.id,
      ),
      ["new2", 8],
    );
  });

  test("Discover's Magic Queue row draws no disliked seed and drops one it showed", () => {
    const pool = {
      trackIds: [1, 2, 3],
      videoIds: ["a", "b"],
      disliked: new Set(["2", "yt:a"]),
    };
    assert.deepEqual(
      randomMagicQueuePicks(pool, () => 0),
      [1, 3, "b"],
    );
    assert.deepEqual(
      randomMagicQueuePicks(pool, () => 0, [2, 3, "a", "b", 1]),
      [3, "b", 1],
    );
  });
});
