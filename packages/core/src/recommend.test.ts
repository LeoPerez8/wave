import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RECOMMEND_WEIGHTS,
  artistGraph,
  magicArtistKey,
  recommend,
  ytTrackId,
  type CatalogSong,
  type GenreProfile,
  type GenreProfileOf,
  type RecommendSources,
  type TasteProfile,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

/** A catalog song by [artists] that the radios of [seeds] brought, first seen [firstSeenAt]. */
const catalogSong = (
  videoId: string,
  artists: string[],
  seeds: string[],
  firstSeenAt = NOW - 30 * DAY,
): CatalogSong => ({
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
  firstSeenAt,
  lastSeenAt: NOW - DAY,
  radios: seeds.map((seedName) => ({
    seed: seedName.toLowerCase(),
    seedName,
    lastSeenAt: NOW - DAY,
  })),
});

const noProfiles: GenreProfileOf = () => undefined;

/** Sources over [catalog] with the graph it makes alone. */
const sources = (
  catalog: CatalogSong[],
  more: Partial<RecommendSources> = {},
): RecommendSources => ({
  catalog,
  graph: artistGraph({ catalog, pages: [], plays: [] }),
  profileOf: noProfiles,
  now: NOW,
  ...more,
});

const ids = (songs: readonly { readonly song: { readonly videoId: string } }[]): string[] =>
  songs.map((entry) => entry.song.videoId);

describe("The engine's candidates", () => {
  test("an artist's are their radio's songs, then their neighbourhood's, closest first", () => {
    const catalog = [
      // Muse's radio: Muse, and Placebo more than Radiohead.
      catalogSong("muse1", ["Muse"], ["Muse"]),
      catalogSong("placebo1", ["Placebo"], ["Muse"]),
      catalogSong("placebo2", ["Placebo"], ["Muse"]),
      catalogSong("radiohead1", ["Radiohead"], ["Muse"]),
      // Placebo's and Radiohead's own radios bring songs Muse's didn't.
      catalogSong("placebo3", ["Placebo"], ["Placebo"]),
      catalogSong("radiohead2", ["Radiohead"], ["Radiohead"]),
      // Nobody close to Muse.
      catalogSong("abba1", ["ABBA"], ["ABBA"]),
    ];
    const ranked = recommend({ artists: ["Muse"] }, sources(catalog));
    assert.deepEqual(ids(ranked).slice(4), ["placebo3", "radiohead2"]);
    assert.deepEqual(new Set(ids(ranked).slice(0, 4)), new Set(["muse1", "placebo1", "placebo2", "radiohead1"]));
    assert.ok(!ids(ranked).includes("abba1"));
  });
});

const rock: GenreProfile = new Map([["rock", 1]]);
const rap: GenreProfile = new Map([["hiphop", 1]]);
const rockPop: GenreProfile = new Map([
  ["rock", 0.5],
  ["pop", 0.5],
]);

/** Profiles by artist name; others unknown. */
const profiles =
  (known: Record<string, GenreProfile | null>): GenreProfileOf =>
  (artist) =>
    known[artist];

describe("A genre family's candidates", () => {
  test("are any catalog song whose artist's profile has a share of the family, across radios", () => {
    const catalog = [
      catalogSong("foo1", ["Foo Fighters"], ["Foo Fighters"]),
      catalogSong("pixies1", ["Pixies"], ["Weezer"]),
      catalogSong("kendrick1", ["Kendrick Lamar"], ["Drake"]),
      catalogSong("nobody1", ["Unknown Band"], ["Nobody"]),
    ];
    const ranked = recommend(
      { artists: ["Foo Fighters"], profile: rock, family: "Rock" },
      sources(catalog, {
        profileOf: profiles({ "Foo Fighters": rock, Pixies: rockPop, "Kendrick Lamar": rap }),
      }),
    );
    assert.deepEqual(ids(ranked), ["foo1", "pixies1"]);
  });
});

describe("The engine's signals", () => {
  test("genre affinity: closer genres first, each song saying how it holds at the threshold", () => {
    const catalog = [
      catalogSong("pop1", ["Pop Act"], ["Muse"]),
      catalogSong("rap1", ["Rapper"], ["Muse"]),
      catalogSong("rock1", ["Rock Band"], ["Muse"]),
      catalogSong("who1", ["Who Knows"], ["Muse"]),
    ];
    const ranked = recommend(
      { artists: ["Muse"], profile: rock },
      sources(catalog, {
        profileOf: profiles({ "Pop Act": rockPop, Rapper: rap, "Rock Band": rock }),
      }),
    );
    assert.deepEqual(
      ranked.map((entry) => [entry.song.videoId, entry.affinity]),
      [
        ["rock1", "match"],
        ["pop1", "match"],
        ["rap1", "miss"],
        ["who1", "unknown"],
      ],
    );
  });
});

describe("The engine's weights", () => {
  /** Two songs on Muse's radio, alike but for [a]'s and [b]'s entries. */
  const pair = (a: Partial<CatalogSong>, b: Partial<CatalogSong>): CatalogSong[] => [
    { ...catalogSong("a", ["Band A"], ["Muse"]), ...a },
    { ...catalogSong("b", ["Band B"], ["Muse"]), ...b },
  ];

  test("taste: a song by an artist the owner likes ranks first, one they skip last", () => {
    const catalog = [
      catalogSong("skipped", ["Skipped"], ["Muse"]),
      catalogSong("plain", ["Plain"], ["Muse"]),
      catalogSong("liked", ["Liked"], ["Muse"]),
    ];
    const taste: TasteProfile = {
      at: NOW,
      songs: new Map(),
      artists: new Map([
        [magicArtistKey("Liked"), 6],
        [magicArtistKey("Skipped"), -6],
      ]),
      genres: new Map(),
    };
    assert.deepEqual(ids(recommend({ artists: ["Muse"] }, sources(catalog, { taste }))), [
      "liked",
      "plain",
      "skipped",
    ]);
    // A YT Music song the owner starred counts as theirs.
    const starred: TasteProfile = { ...taste, songs: new Map([[ytTrackId("plain"), 3]]) };
    assert.equal(
      ids(recommend({ artists: ["Muse"] }, sources(catalog, { taste: starred })))[0],
      "plain",
    );
  });

  test("newness: a song the catalog saw lately ranks before one it has had for long", () => {
    const catalog = pair({ firstSeenAt: NOW - 60 * DAY }, { firstSeenAt: NOW - DAY });
    assert.deepEqual(ids(recommend({ artists: ["Muse"] }, sources(catalog))), ["b", "a"]);
  });

  test("popularity is neutral by default; weighed, songs more radios carry go first, or last", () => {
    const radio = (seedName: string) => ({
      seed: seedName.toLowerCase(),
      seedName,
      lastSeenAt: NOW,
    });
    const catalog = pair(
      { radios: [radio("Muse"), radio("Placebo"), radio("Radiohead")] },
      { firstSeenAt: NOW - 30 * DAY + 1 },
    );
    const seed = { artists: ["Muse"] };
    // Neutral: the tie goes to the song seen first.
    assert.deepEqual(ids(recommend(seed, sources(catalog), { weights: { newness: 0 } })), [
      "a",
      "b",
    ]);
    assert.deepEqual(
      ids(recommend(seed, sources(catalog), { weights: { newness: 0, popularity: 1 } })),
      ["a", "b"],
    );
    assert.deepEqual(
      ids(recommend(seed, sources(catalog), { weights: { newness: 0, popularity: -1 } })),
      ["b", "a"],
    );
  });

  test("the defaults are named, and a weight given replaces its default alone", () => {
    assert.deepEqual(RECOMMEND_WEIGHTS, {
      closeness: 1,
      affinity: 0.5,
      taste: 0.5,
      newness: 0.25,
      popularity: 0,
      variety: 0.25,
    });
    // Closeness off: a farther artist's newer song beats the seed's radio's older one.
    const catalog = [
      catalogSong("onRadio", ["Placebo"], ["Muse"], NOW - 60 * DAY),
      catalogSong("near", ["Placebo"], ["Placebo"], NOW),
    ];
    const seed = { artists: ["Muse"] };
    assert.deepEqual(ids(recommend(seed, sources(catalog))), ["onRadio", "near"]);
    assert.deepEqual(ids(recommend(seed, sources(catalog), { weights: { closeness: 0 } })), [
      "near",
      "onRadio",
    ]);
  });

  test("genre faithfulness: a lower threshold lets a less alike artist match", () => {
    const catalog = [catalogSong("pop1", ["Pop Act"], ["Muse"])];
    const at = (threshold: number) =>
      recommend(
        { artists: ["Muse"], profile: rock },
        sources(catalog, { profileOf: profiles({ "Pop Act": rockPop }) }),
        { threshold },
      )[0]?.affinity;
    assert.equal(at(0.5), "match");
    assert.equal(at(0.8), "miss");
  });

  test("what the section showed today goes after every other song", () => {
    const catalog = pair({}, { firstSeenAt: NOW - 60 * DAY });
    assert.deepEqual(
      ids(recommend({ artists: ["Muse"] }, sources(catalog), { avoid: new Set(["a"]) })),
      ["b", "a"],
    );
  });

  test("variety nudges by [random] only when it's given", () => {
    const catalog = pair({}, { firstSeenAt: NOW - 30 * DAY + 1 });
    const seed = { artists: ["Muse"] };
    const weights = { newness: 0 };
    assert.deepEqual(ids(recommend(seed, sources(catalog), { weights })), ["a", "b"]);
    const draws = [0, 1];
    const random = () => draws.shift() ?? 0;
    assert.deepEqual(ids(recommend(seed, sources(catalog), { weights, random })), ["b", "a"]);
  });

  test("without an artist graph, only the seeds' radios and songs are candidates", () => {
    const catalog = [
      catalogSong("muse1", ["Muse"], []),
      catalogSong("placebo1", ["Placebo"], ["Muse"]),
      catalogSong("placebo2", ["Placebo"], ["Placebo"]),
    ];
    const ranked = recommend({ artists: ["Muse"] }, sources(catalog, { graph: null }));
    assert.deepEqual(
      ranked.map((entry) => [entry.song.videoId, entry.closeness, entry.onSeedRadio]),
      [
        ["muse1", 1, false],
        ["placebo1", 1, true],
      ],
    );
  });
});
