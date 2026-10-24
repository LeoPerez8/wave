import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rankedDiscoverMixRead,
  artistGraph,
  discoverMixesOfRadios,
  mixKnownSongs,
  type YtAlbumSong,
} from "./index.ts";

const seed = { kind: "artist" as const, id: "artist:seed", name: "Seed", from: "plays" as const };
const songs: YtAlbumSong[] = Array.from({ length: 20 }, (_, i) => ({
  videoId: `v${i}`,
  title: `Song ${i}`,
  artists: [`Artist ${i}`],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
}));
const library = { artists: [{ id: 1, name: "Seed" }], songs: [] };
const known = mixKnownSongs({
  library: [],
  playedRecordingKeys: [],
  streamed: [{ song: songs[0]!, plays: 1, firstPlayedAt: 0 }],
  playlisted: [],
});

test("an artist mix keeps radio order, excludes known songs and has a full mix without genres", () => {
  const read = rankedDiscoverMixRead(
    seed,
    {
      pages: [{ id: "artist:seed", artists: ["Seed"], songs }],
    },
    { faithfulness: 1 },
  );
  const [mix] = discoverMixesOfRadios([read], { library, known });
  assert.deepEqual(
    mix?.songs.map((s) => s.videoId),
    [
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
      "v7",
      "v8",
      "v9",
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
      "v16",
      "v17",
      "v18",
      "v19",
    ],
  );
});

test("taste can lift a radio song without adding songs from graph neighbours or the Library", () => {
  const sources = {
    pages: [{ id: "artist:seed", artists: ["Seed"], songs }],
    taste: { at: 0, songs: new Map([["yt:v2", 100]]), artists: new Map(), genres: new Map() },
    graph: artistGraph({
      catalog: [],
      plays: [],
      pages: [{ name: "Seed", similar: [{ name: "Neighbour", browseId: "n", audience: null }] }],
    }),
    library: [
      { trackId: "local", artists: ["seed"], genre: null, style: null },
      { trackId: "neighbour", artists: ["neighbour"], genre: null, style: null },
    ],
  };
  const read = rankedDiscoverMixRead(seed, sources);
  const [mix] = discoverMixesOfRadios([read], { library, known });
  assert.equal(mix?.songs[0]?.videoId, "v2");
  assert.equal(mix?.songs.length, 19);
  assert.ok(mix?.songs.every((song) => songs.some((radio) => radio.videoId === song.videoId)));
});

test("Discover applies shared genre penalties and popularity without an old affinity gate", () => {
  const sources = {
    pages: [{ id: "artist:seed", artists: ["Seed"], songs }],
    profileOf: (name: string) => (name === "Artist 1" ? new Map([["metal", 1]]) : null),
    popularityOf: (id: string) => (id === "v2" ? 1 : 0),
  };
  const read = (faithfulness: 1 | 2 | 3 | 4 | 5, popularity: 1 | 3 | 5 = 3) =>
    rankedDiscoverMixRead(seed, sources, {
      profile: new Map([["reggae", 1]]),
      faithfulness,
      popularity,
    });
  assert.ok(read(1).radio.every((song) => song.videoId !== "v1"));
  assert.equal(read(5).radio[1]?.videoId, "v1");
  assert.equal(read(2).radio.at(-1)?.videoId, "v1");
  assert.equal(read(5, 1).radio[1]?.videoId, "v2");
});
