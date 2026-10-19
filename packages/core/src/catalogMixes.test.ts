import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  discoverMixesOfCatalog,
  mixKnownSongs,
  type CatalogSong,
  type DiscoverMix,
  type DiscoverMixSeed,
  type GenreProfile,
  type GenreProfileOf,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

const catalogSong = (
  videoId: string,
  artist: string,
  seeds: string[],
  title = `Song ${videoId}`,
): CatalogSong => ({
  song: {
    videoId,
    title,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: NOW - 30 * DAY,
  lastSeenAt: NOW - DAY,
  radios: seeds.map((seedName) => ({
    seed: seedName.toLowerCase(),
    seedName,
    lastSeenAt: NOW - DAY,
  })),
});

/** [count] songs by [artist] that [seed]'s radio brought (video ids `${prefix}${n}`). */
const songs = (prefix: string, count: number, artist: string, seed: string): CatalogSong[] =>
  Array.from({ length: count }, (_, n) => catalogSong(`${prefix}${n + 1}`, artist, [seed]));

const artistSeed = (name: string): DiscoverMixSeed => ({
  kind: "artist",
  id: `artist:${name.toLowerCase()}`,
  name,
  from: "plays",
});

const artists = [
  { id: 1, name: "Portishead" },
  { id: 2, name: "Foo Fighters" },
];
const gloryBox = {
  id: 10,
  title: "Glory Box",
  artist: "Portishead",
  artistIds: [1],
  durationMs: 200_000,
  addedAt: 1,
};
const everlong = {
  id: 20,
  title: "Everlong",
  artist: "Foo Fighters",
  artistIds: [2],
  durationMs: 200_000,
  addedAt: 1,
  genre: "Rock",
};
const library = { artists, songs: [gloryBox, everlong] };
const known = mixKnownSongs({
  library: library.songs,
  playedRecordingKeys: [],
  streamed: [],
  playlisted: [],
});

const sources = (catalog: CatalogSong[], profileOf: GenreProfileOf = () => undefined) => ({
  catalog,
  graph: artistGraph({ catalog, pages: [], plays: [] }),
  profileOf,
  now: NOW,
});

const videos = (mix: DiscoverMix | undefined) => mix?.songs.map((song) => song.videoId);

describe("Mixes built from the candidate catalog", () => {
  test("an artist mix draws from the seed's radio, then its graph neighbourhood", () => {
    const catalog = [
      // Portishead's radio: Glory Box (the owner's), and Tricky.
      catalogSong("glory", "Portishead", ["Portishead"], "Glory Box"),
      ...songs("t", 10, "Tricky", "Portishead"),
      // Tricky's radio brought more of Tricky's: close to Portishead through him.
      ...songs("tt", 3, "Tricky", "Tricky"),
      // Nobody near Portishead.
      ...songs("abba", 12, "ABBA", "ABBA"),
    ];
    const [mix, ...others] = discoverMixesOfCatalog([artistSeed("Portishead")], sources(catalog), {
      known,
      library,
    });
    assert.equal(others.length, 0);
    // The radio's songs first, then the neighbour's own radio's.
    assert.deepEqual(
      new Set(videos(mix)?.slice(0, 10)),
      new Set(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"]),
    );
    assert.deepEqual(new Set(videos(mix)?.slice(10)), new Set(["tt1", "tt2", "tt3"]));
    // The owner's song its radio played leads its familiar share.
    assert.deepEqual(
      mix?.familiar?.map((song) => (song.source === "library" ? song.track.id : null)),
      [10],
    );
  });

  test("a genre mix draws from the family's songs across artists", () => {
    const rock: GenreProfile = new Map([["rock", 1]]);
    const rap: GenreProfile = new Map([["hiphop", 1]]);
    const catalog = [
      ...songs("weezer", 6, "Weezer", "Weezer"),
      ...songs("pixies", 6, "Pixies", "Pixies"),
      ...songs("drake", 6, "Drake", "Drake"),
    ];
    const profiles: Record<string, GenreProfile> = { Weezer: rock, Pixies: rock, Drake: rap };
    const seed: DiscoverMixSeed = {
      kind: "genre",
      id: "genre:rock",
      name: "Rock",
      from: "plays",
      genre: "Rock",
      artists: [{ id: 2, name: "Foo Fighters" }],
    };
    const [mix] = discoverMixesOfCatalog(
      [seed],
      sources(catalog, (artist: string) => profiles[artist]),
      { known, library },
    );
    assert.deepEqual(
      new Set(videos(mix)?.map((id) => id.replace(/\d+$/u, ""))),
      new Set(["weezer", "pixies"]),
    );
    assert.equal(mix?.songs.length, 12);
  });

  test("a seed with too few candidates yet makes no mix; the others are built", () => {
    const catalog = [
      ...songs("t", 12, "Tricky", "Tricky"),
      ...songs("m", 3, "Massive Attack", "Massive Attack"),
    ];
    const mixes = discoverMixesOfCatalog(
      [artistSeed("Massive Attack"), artistSeed("Tricky")],
      sources(catalog),
      { known, library },
    );
    assert.deepEqual(
      mixes.map((mix) => mix.id),
      ["artist:tricky"],
    );
  });

  test("a song is in one of the section's mixes, the earlier seed's", () => {
    const catalog = songs("both", 12, "Tricky", "Portishead").map((entry) => ({
      ...entry,
      radios: [...entry.radios, { seed: "tricky", seedName: "Tricky", lastSeenAt: NOW }],
    }));
    const mixes = discoverMixesOfCatalog(
      [artistSeed("Portishead"), artistSeed("Tricky")],
      sources(catalog),
      { known, library },
    );
    assert.deepEqual(
      mixes.map((mix) => mix.id),
      ["artist:portishead"],
    );
  });

  test("a refresh's avoided songs come back only to make up the mix's ten", () => {
    const catalog = songs("t", 14, "Tricky", "Tricky");
    const avoid = new Set(["t1", "t2", "t3", "t4", "t5", "t6"]);
    const [mix] = discoverMixesOfCatalog([artistSeed("Tricky")], sources(catalog), {
      known,
      library,
      avoid,
    });
    assert.equal(mix?.songs.length, 10);
    assert.deepEqual(videos(mix)?.filter((id) => avoid.has(id)).length, 2);
  });
});
