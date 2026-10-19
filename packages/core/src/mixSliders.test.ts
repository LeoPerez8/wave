import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_MIX_SLIDERS,
  GENRE_FAITHFULNESS_STEPS,
  POPULARITY_STEPS,
  artistGraph,
  mixSlidersEngine,
  readMixSliders,
  recommend,
  sliderStep,
  sliderStepLabel,
  storedMixSliders,
  type CatalogSong,
  type GenreProfile,
  type GenreProfileOf,
  type RecommendSources,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

/** A catalog song by [artist] that the radios of [seeds] brought. */
const catalogSong = (
  videoId: string,
  artist: string,
  seeds: string[],
  firstSeenAt = NOW - 30 * DAY,
): CatalogSong => ({
  song: {
    videoId,
    title: `Song ${videoId}`,
    artists: [artist],
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

const rock: GenreProfile = new Map([["rock", 1]]);
/** Rock with a minor share of pop: affinity to rock ~0.89. */
const mostlyRock: GenreProfile = new Map([
  ["rock", 2 / 3],
  ["pop", 1 / 3],
]);
/** Half rock: affinity to rock ~0.71. */
const rockPop: GenreProfile = new Map([
  ["rock", 0.5],
  ["pop", 0.5],
]);
/** A little rock: affinity to rock ~0.32. */
const popRock: GenreProfile = new Map([
  ["rock", 0.3],
  ["pop", 0.9],
]);

const profileOf: GenreProfileOf = (artist) =>
  ({ Muse: rock, "Mostly Rock": mostlyRock, "Rock Pop": rockPop, "Pop Rock": popRock })[artist];

/** Muse's radio: songs of every genre, some carried by many radios, seen at different times. */
const catalog = [
  catalogSong("muse1", "Muse", ["Muse"], NOW - 50 * DAY),
  catalogSong("hit", "Rock Pop", ["Muse", "Placebo", "Radiohead", "Blur"], NOW - 40 * DAY),
  catalogSong("cut", "Rock Pop", ["Muse"], NOW - 2 * DAY),
  catalogSong("close", "Mostly Rock", ["Muse", "Placebo"], NOW - 10 * DAY),
  catalogSong("far", "Pop Rock", ["Muse"], NOW - 5 * DAY),
  catalogSong("other", "Placebo", ["Placebo"], NOW - 20 * DAY),
];

const sources: RecommendSources = {
  catalog,
  graph: artistGraph({ catalog, pages: [], plays: [] }),
  profileOf,
  now: NOW,
};
const seed = { artists: ["Muse"], profile: rock };

const ranking = (options = {}) =>
  recommend(seed, sources, options).map((entry) => [entry.song.videoId, entry.affinity]);

const matches = (options = {}) =>
  recommend(seed, sources, options)
    .filter((entry) => entry.affinity === "match")
    .map((entry) => entry.song.videoId);

describe("A section's sliders", () => {
  test("at their defaults, rank the catalog as the engine does without them", () => {
    assert.deepEqual(ranking(mixSlidersEngine(DEFAULT_MIX_SLIDERS)), ranking());
  });

  test("Genre faithfulness: staying close leaves out what half-matches; wandering lets in neighbours", () => {
    // Today's threshold (0.5): the half-rock songs match, the pop one with a little rock doesn't.
    assert.deepEqual(new Set(matches()), new Set(["muse1", "hit", "cut", "close"]));
    const strictest = mixSlidersEngine({ ...DEFAULT_MIX_SLIDERS, faithfulness: 1 });
    assert.deepEqual(new Set(matches(strictest)), new Set(["muse1", "close"]));
    const wanders = mixSlidersEngine({ ...DEFAULT_MIX_SLIDERS, faithfulness: 5 });
    assert.deepEqual(new Set(matches(wanders)), new Set(["muse1", "hit", "cut", "close", "far"]));
  });

  test("Popularity: hits put what many radios carry first; deep cuts put it last", () => {
    const order = (popularity: 1 | 2 | 3 | 4 | 5) => {
      const ids = recommend(
        seed,
        sources,
        mixSlidersEngine({ ...DEFAULT_MIX_SLIDERS, popularity }),
      ).map((entry) => entry.song.videoId);
      return ids.filter((id) => id === "hit" || id === "cut");
    };
    // Neutral: the newer song first, as today.
    assert.deepEqual(order(3), ["cut", "hit"]);
    assert.deepEqual(order(1), ["hit", "cut"]);
    assert.deepEqual(order(5), ["cut", "hit"]);
    // Deep cuts push the four-radio hit below the one-radio Pop Rock song it beat before.
    const deep = recommend(
      seed,
      sources,
      mixSlidersEngine({ ...DEFAULT_MIX_SLIDERS, popularity: 5 }),
    );
    const ids = deep.map((entry) => entry.song.videoId);
    assert.ok(ids.indexOf("far") < ids.indexOf("hit"));
    assert.ok(
      ranking().findIndex(([id]) => id === "hit") < ranking().findIndex(([id]) => id === "far"),
    );
  });

  test("each has five steps named from one end to the other, the middle one the default", () => {
    assert.deepEqual(
      GENRE_FAITHFULNESS_STEPS.map((step) => step.label),
      ["Same genres", "Close", "Balanced", "Neighbours", "Wander"],
    );
    assert.deepEqual(
      POPULARITY_STEPS.map((step) => step.label),
      ["Hits", "Popular", "Balanced", "Lesser known", "Deep cuts"],
    );
    assert.deepEqual(DEFAULT_MIX_SLIDERS, { faithfulness: 3, popularity: 3 });
  });
});

describe("Keeping a section's sliders", () => {
  test("round-trips them; the defaults store nothing", () => {
    const sliders = { faithfulness: 5, popularity: 1 } as const;
    assert.deepEqual(readMixSliders(storedMixSliders(sliders)), sliders);
    assert.equal(storedMixSliders(DEFAULT_MIX_SLIDERS), null);
    assert.deepEqual(readMixSliders(storedMixSliders({ faithfulness: 2, popularity: 3 })), {
      faithfulness: 2,
      popularity: 3,
    });
  });

  test("reads the defaults for nothing stored, and for any slider that isn't a step", () => {
    assert.deepEqual(readMixSliders(null), DEFAULT_MIX_SLIDERS);
    assert.deepEqual(readMixSliders("not json"), DEFAULT_MIX_SLIDERS);
    assert.deepEqual(readMixSliders('{"faithfulness":9,"popularity":4}'), {
      faithfulness: 3,
      popularity: 4,
    });
    assert.deepEqual(readMixSliders('{"faithfulness":2.5,"popularity":"1"}'), DEFAULT_MIX_SLIDERS);
  });
});

describe("A level card slider's position", () => {
  test("lands on the nearest of the five steps, within them", () => {
    assert.deepEqual(
      [0, 1, 2.4, 2.6, 5, 9].map((value) => sliderStep(value)),
      [1, 1, 2, 3, 5, 5],
    );
  });

  test("reads as its step's label", () => {
    assert.equal(sliderStepLabel(GENRE_FAITHFULNESS_STEPS, 1.2), "Same genres");
    assert.equal(sliderStepLabel(POPULARITY_STEPS, 4.8), "Deep cuts");
  });
});
