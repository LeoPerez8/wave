import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  catalogMixRead,
  catalogMixReader,
  discoverMixesOfCatalog,
  mixSlidersEngine,
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

/** A reader of catalog reads over [catalog], as a build makes one. */
const readerOf = (catalog: CatalogSong[], profileOf?: GenreProfileOf) =>
  catalogMixReader({ ...sources(catalog, profileOf), library });

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
    const [mix, ...others] = discoverMixesOfCatalog([artistSeed("Portishead")], readerOf(catalog), {
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
      readerOf(catalog, (artist: string) => profiles[artist]),
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
      readerOf(catalog),
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
      readerOf(catalog),
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
    const [mix] = discoverMixesOfCatalog([artistSeed("Tricky")], readerOf(catalog), {
      known,
      library,
      avoid,
    });
    assert.equal(mix?.songs.length, 10);
    assert.deepEqual(videos(mix)?.filter((id) => avoid.has(id)).length, 2);
  });
});

describe("Re-ranking a seed's catalog read", () => {
  const rock: GenreProfile = new Map([["rock", 1]]);
  const rockPop: GenreProfile = new Map([
    ["rock", 0.5],
    ["pop", 0.5],
  ]);
  const profiles: Record<string, GenreProfile> = { Tricky: rock, Pixies: rockPop };
  const profileOf: GenreProfileOf = (artist) => profiles[artist];
  const catalog = [
    ...songs("t", 6, "Tricky", "Tricky"),
    ...songs("p", 6, "Pixies", "Tricky").map((entry, n) =>
      n % 2 === 0
        ? {
            ...entry,
            radios: [...entry.radios, { seed: "blur", seedName: "Blur", lastSeenAt: NOW }],
          }
        : entry,
    ),
    ...songs("u", 4, "Unknown", "Tricky"),
  ];
  const seed = artistSeed("Tricky");
  const read = (got: ReturnType<typeof catalogMixRead>) =>
    got === null
      ? null
      : {
          radio: got.radio.map((song) => song.videoId),
          affinity: got.radio.map((song) => got.affinity?.(song)),
          familiar: got.familiar?.map((song) => song.videoId),
        };
  const settings = [
    mixSlidersEngine({ faithfulness: 3, popularity: 3 }),
    mixSlidersEngine({ faithfulness: 1, popularity: 1 }),
    mixSlidersEngine({ faithfulness: 5, popularity: 5 }),
    mixSlidersEngine({ faithfulness: 3, popularity: 3 }),
  ];

  test("at any sliders reads what a fresh read at them does", () => {
    const reader = catalogMixReader({ ...sources(catalog, profileOf), library });
    for (const engine of settings)
      assert.deepEqual(
        read(reader.read(seed, engine)),
        read(catalogMixRead(seed, { ...sources(catalog, profileOf), library }, engine)),
      );
  });

  test("keeps the build's variety: the same variety reads the same, sliders back where they were", () => {
    const of = (variety: number) =>
      catalogMixReader({ ...sources(catalog, profileOf), library }, { variety });
    const reader = of(7);
    const first = read(reader.read(seed, settings[0]!));
    for (const engine of settings.slice(1)) reader.read(seed, engine);
    assert.deepEqual(read(reader.read(seed, settings[0]!)), first);
    assert.deepEqual(read(of(7).read(seed, settings[0]!)), first);
    assert.notDeepEqual(read(of(8).read(seed, settings[0]!)), first);
  });
});
