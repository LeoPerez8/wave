import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MIX_SLIDERS,
  discoverMixName,
  mixKnownSongs,
  rankedDiscoverMixes,
  type DiscoverMixSeed,
  type YtAlbumSong,
} from "./index.ts";

const song = (videoId: string, artist: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});
const run = (prefix: string, count: number, artist: string) =>
  Array.from({ length: count }, (_, n) => song(`${prefix}${n}`, artist));

const portishead: DiscoverMixSeed = {
  kind: "artist",
  id: "artist:portishead",
  name: "Portishead",
  from: "plays",
};
const electronic: DiscoverMixSeed = {
  kind: "genre",
  id: "genre:electronic",
  name: "Electronic",
  genre: "Electronic",
  from: "plays",
  artists: [{ id: 2, name: "Daft Punk" }],
};
const library = { artists: [{ id: 1, name: "Portishead" }], songs: [] };
const known = mixKnownSongs({
  library: [],
  playedRecordingKeys: [],
  streamed: [{ song: song("p0", "Portishead"), plays: 1, firstPlayedAt: 0 }],
  playlisted: [],
});

test("both rows rank each seed's radio pages and leave out known songs and earlier mixes' songs", () => {
  const mixes = rankedDiscoverMixes(
    [
      {
        seed: portishead,
        pages: [{ id: "Portishead", artists: ["Portishead"], songs: run("p", 14, "Tricky") }],
      },
      {
        seed: electronic,
        pages: [
          {
            id: "Daft Punk",
            artists: ["Daft Punk"],
            songs: [...run("p", 4, "Tricky"), ...run("d", 12, "Justice")],
          },
        ],
      },
    ],
    { library, known },
    { faithfulness: 1, popularity: 3 },
  );
  assert.deepEqual(
    mixes.map((mix) => mix.id),
    ["artist:portishead", "genre:electronic"],
  );
  const [artist, genre] = mixes;
  assert.ok(
    artist!.songs.every((found) => found.videoId !== "p0"),
    "a played song is known",
  );
  assert.ok(
    genre!.songs.every((found) => found.videoId.startsWith("d")),
    "the artist mix took the radios' shared songs",
  );
});

test("a seed whose radio brought nothing makes no mix", () => {
  assert.deepEqual(
    rankedDiscoverMixes([{ seed: portishead, pages: [] }], { library, known }, DEFAULT_MIX_SLIDERS),
    [],
  );
});

test("a mix is named after its seed artist, or its genre family with capital initials", () => {
  assert.equal(discoverMixName(portishead), "Portishead");
  assert.equal(discoverMixName({ name: "hip hop", genre: "hip hop" }), "Hip Hop");
  assert.equal(discoverMixName(electronic), "Electronic");
});
