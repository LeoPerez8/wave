import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  magicCatalogCandidates,
  magicLibraryCandidates,
  magicRadioLookups,
  magicSeedProfile,
  parseMagicSession,
  startMagicQueue,
  type CatalogSong,
  type GenreProfileOf,
  type MagicSession,
} from "./index.ts";

/**
 * A Magic Queue from an untagged song by "Obscure Band", an artist YouTube
 * Music doesn't find by name and Deezer doesn't know.
 */
const obscureSeed = (): MagicSession => {
  const started = startMagicQueue(
    { kind: "track", id: "1", title: "Untagged Song" },
    [{ trackId: "1", artists: [], genre: null, style: null }],
    {
      id: "s1",
      random: () => 0,
      radio: { artists: ["Obscure Band"], profile: null, videoIds: ["seedVideo"] },
    },
  );
  assert.ok(started !== null);
  return started.session;
};

/** Deezer knows the song radio's artists, not the seed's: "Obscure Band" was looked up, with nothing found. */
const profiles: Record<string, ReadonlyMap<string, number> | null> = {
  "Obscure Band": null,
  "Metal One": new Map([["metal", 1]]),
  "Metal Two": new Map([["metal", 0.5], ["rock", 0.5]]),
  "Pop Star": new Map([["pop", 1]]),
};
const profileOf: GenreProfileOf = (artist) => profiles[artist];

describe("A Magic Queue seed with no genre known", () => {
  test("takes its genre from the artists its song radio brought, each artist counted once", () => {
    const radio = [
      { artists: ["Metal One"] },
      { artists: ["Metal One", "Someone"] },
      { artists: ["Metal Two"] },
      { artists: ["Unknown Act"] },
    ];
    assert.equal(magicSeedProfile(obscureSeed(), profileOf), null);
    assert.deepEqual(
      magicSeedProfile(obscureSeed(), profileOf, radio),
      new Map([
        ["metal", 0.75],
        ["rock", 0.25],
      ]),
    );
  });
});

test("a Magic Queue keeps its seed songs' video ids through a restart; one saved before reads back without", () => {
  const saved = JSON.parse(JSON.stringify(obscureSeed())) as Record<string, unknown>;
  assert.deepEqual(parseMagicSession(saved)?.seedVideoIds, ["seedVideo"]);
  const { seedVideoIds: _, ...before } = saved;
  assert.deepEqual(parseMagicSession(before)?.seedVideoIds, []);
});

const NOW = 1_000_000_000_000;

/** A catalog song by [artists] that [seed]'s radio brought. */
const catalogSong = (videoId: string, artists: string[], seed: string): CatalogSong => ({
  song: {
    videoId,
    title: `Song ${videoId}`,
    artists,
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: NOW,
  lastSeenAt: NOW,
  radios: [{ seed: seed.toLowerCase(), seedName: seed, lastSeenAt: NOW }],
});

/** What the seed song's own radio brought, written as its artist's radio, and another radio's song. */
const catalog = [
  catalogSong("metal1", ["Metal One"], "Obscure Band"),
  catalogSong("metal2", ["Metal Two"], "Obscure Band"),
  catalogSong("pop1", ["Pop Star"], "Obscure Band"),
  catalogSong("neighbour", ["Metal One"], "Someone Else"),
];
const sources = (songs: CatalogSong[] = catalog) => ({
  catalog: songs,
  graph: artistGraph({ catalog: songs, pages: [], plays: [] }),
  profileOf,
  now: NOW,
});
const videoIds = (pick: ReturnType<typeof magicCatalogCandidates>) =>
  new Set(pick.candidates.map((candidate) => candidate.song.videoId));

describe("A Magic Queue seed with no genre known, in the catalog", () => {
  test("its radio's songs, and its neighbours', that match the genre its radio gave it are its candidates", () => {
    const pick = magicCatalogCandidates(obscureSeed(), sources(), { inLibrary: () => false });
    assert.deepEqual(videoIds(pick), new Set(["metal1", "metal2", "neighbour"]));
    assert.deepEqual(
      pick.profile,
      new Map([
        ["metal", 0.5],
        ["rock", 1 / 6],
        ["pop", 1 / 3],
      ]),
    );
  });
});

describe("A Magic Queue seed whose genre stays unknown", () => {
  const nothingKnown: GenreProfileOf = () => null;
  const unknownCatalog = [
    catalogSong("act-a", ["Act A"], "Obscure Band"),
    catalogSong("act-b", ["Act B"], "Obscure Band"),
    catalogSong("far", ["Far Act"], "Someone Else"),
  ];

  test("picks the songs its radios brought, with no genre check, at every faithfulness step", () => {
    for (const engine of [{}, { threshold: 0.65, styles: "close" as const }]) {
      const pick = magicCatalogCandidates(
        obscureSeed(),
        { ...sources(unknownCatalog), profileOf: nothingKnown },
        { inLibrary: () => false, engine },
      );
      assert.equal(pick.profile, null);
      assert.deepEqual(videoIds(pick), new Set(["act-a", "act-b"]));
    }
  });
});

describe("A Magic Queue seed with no genre known, in the Library", () => {
  const library = {
    artists: [
      { id: 1, name: "Obscure Band" },
      { id: 2, name: "Metal One" },
      { id: 3, name: "Pop Star" },
      { id: 4, name: "Stranger" },
    ],
    songs: [
      { id: 10, artistIds: [1], genre: null },
      { id: 11, artistIds: [2], genre: "Metal" },
      { id: 12, artistIds: [3], genre: "Pop" },
      { id: 13, artistIds: [4], genre: null },
    ],
  };
  const ids = (songs: readonly { readonly trackId: string }[]) => songs.map((song) => song.trackId);

  test("holds Library songs to the genre its song radio gave it", () => {
    const seedProfile = magicSeedProfile(obscureSeed(), profileOf, [{ artists: ["Metal One"] }]);
    assert.deepEqual(
      ids(magicLibraryCandidates(obscureSeed(), library, { profileOf, seedProfile })),
      ["11"],
    );
  });

  test("with its genre unknown everywhere, picks only its own artists' songs and their neighbours'", () => {
    const graph = artistGraph({ catalog, pages: [], plays: [] });
    for (const options of [{}, { threshold: 0.65, styles: "close" as const }]) {
      assert.deepEqual(
        ids(
          magicLibraryCandidates(obscureSeed(), library, {
            profileOf: () => null,
            seedProfile: null,
            graph,
            ...options,
          }),
        ),
        ["10", "11", "12"],
      );
    }
  });
});

test("a refill looks up its song radio's artists while the seed's genre is unknown, ten a round", () => {
  const radio = Array.from({ length: 14 }, (_, at) => ({
    ...catalogSong(`act${at}`, [`Act ${at}`, "Featured Guest"], "Obscure Band").song,
    video: false,
  }));
  const neverAsked: GenreProfileOf = (artist) => (artist === "Obscure Band" ? null : undefined);
  const first = magicRadioLookups(obscureSeed(), radio, {
    profileOf: neverAsked,
    inLibrary: () => false,
  });
  assert.deepEqual(
    first,
    Array.from({ length: 10 }, (_, at) => `Act ${at}`),
  );
  const unknownOnDeezer: GenreProfileOf = (artist) =>
    first.includes(artist) || artist === "Obscure Band" ? null : undefined;
  assert.deepEqual(
    magicRadioLookups(obscureSeed(), radio, {
      profileOf: unknownOnDeezer,
      inLibrary: () => false,
      asked: first,
    }),
    ["Act 10", "Act 11", "Act 12", "Act 13"],
  );
});
