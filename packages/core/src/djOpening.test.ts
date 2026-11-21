import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  djOpeningGrid,
  magicArtistKey,
  type DiscoverMixesSection,
  type DjOpeningGrid,
  type DjOpeningSources,
  type TasteProfile,
} from "./index.ts";

/** A taste profile scoring [artists] by name. */
const tasteOf = (artists: Record<string, number>): TasteProfile => ({
  at: 0,
  songs: new Map(),
  artists: new Map(Object.entries(artists).map(([name, score]) => [magicArtistKey(name), score])),
  genres: new Map(),
});

/** The Artist mixes row showing a mix for each of [seeds], an artist and where its seed came from. */
const mixesOf = (
  ...seeds: readonly (readonly [string, "plays" | "library" | "similar" | "chart"])[]
): DiscoverMixesSection => ({
  kind: "mixes",
  updating: false,
  failed: false,
  mixes: seeds.map(([name, from]) => ({
    id: `artist:${name}`,
    seed: { kind: "artist", name, from },
    songs: [],
  })),
});

/** A fresh install: an empty Library, no plays, no taste profile and no artist graph. */
const fresh = (artistMixes: DiscoverMixesSection): DjOpeningSources => ({
  artists: [],
  taste: null,
  graph: null,
  artistMixes,
});

/** The names an opening's grid shows, or what it shows in their place. */
const shown = (opening: DjOpeningGrid): string[] | DjOpeningGrid["kind"] =>
  opening.kind === "tiles" ? opening.tiles.map((tile) => tile.name) : opening.kind;

describe("DJ's grid with no taste signal", () => {
  test("shows the artists the chart-seeded Artist mixes grew from, in their order", () => {
    const opening = djOpeningGrid(
      fresh(mixesOf(["Dua Lipa", "chart"], ["Bad Bunny", "chart"], ["Karol G", "chart"])),
    );
    assert.deepEqual(shown(opening), ["Dua Lipa", "Bad Bunny", "Karol G"]);
    assert.ok(opening.kind === "tiles");
    assert.deepEqual(
      opening.tiles.map((tile) => [tile.kind, tile.libraryId]),
      [
        ["artist", null],
        ["artist", null],
        ["artist", null],
      ],
    );
  });

  test("shows a chart artist once, however their mixes spell the name", () => {
    assert.deepEqual(
      shown(djOpeningGrid(fresh(mixesOf(["Dua Lipa", "chart"], ["DUA LIPA", "chart"])))),
      ["Dua Lipa"],
    );
  });

  test("leaves out mixes that weren't seeded from the chart, and genre mixes", () => {
    const row = mixesOf(["Portishead", "similar"], ["Dua Lipa", "chart"], ["Tricky", "library"]);
    const genre = {
      id: "genre:pop",
      seed: { kind: "genre", name: "Pop", from: "chart" },
      songs: [],
    } as const;
    assert.ok(row.kind === "mixes");
    assert.deepEqual(shown(djOpeningGrid(fresh({ ...row, mixes: [genre, ...row.mixes] }))), [
      "Dua Lipa",
    ]);
  });

  test("shows a chart artist the Library has as the Library's artist", () => {
    const opening = djOpeningGrid({
      ...fresh(mixesOf(["Dua Lipa", "chart"])),
      artists: [{ id: 7, name: "dua lipa" }],
      taste: tasteOf({}),
    });
    assert.ok(opening.kind === "tiles");
    assert.deepEqual(
      opening.tiles.map((tile) => [tile.name, tile.libraryId]),
      [["dua lipa", 7]],
    );
  });

  test("shows placeholder tiles while the first Artist mixes build", () => {
    assert.equal(shown(djOpeningGrid(fresh({ kind: "skeleton", failed: false }))), "skeleton");
  });

  test("has nothing to pick when no chart-seeded mix can come", () => {
    for (const row of [
      { kind: "hidden", failed: false },
      { kind: "empty", failed: true },
      mixesOf(["Portishead", "similar"]),
      mixesOf(["Various Artists", "chart"]),
    ] satisfies DiscoverMixesSection[])
      assert.equal(shown(djOpeningGrid(fresh(row))), "nothing");
  });
});

describe("DJ's grid once there's a taste signal", () => {
  const library = [
    { id: 1, name: "Portishead" },
    { id: 2, name: "Tricky" },
  ];
  const chart = mixesOf(["Dua Lipa", "chart"], ["Bad Bunny", "chart"]);

  test("comes from the taste profile, whatever the Artist mixes show", () => {
    const taste = tasteOf({ Portishead: 2, Tricky: 5 });
    for (const artistMixes of [chart, { kind: "skeleton", failed: false } as const])
      assert.deepEqual(
        shown(djOpeningGrid({ artists: library, taste, graph: null, artistMixes })),
        ["Tricky", "Portishead"],
      );
  });

  test("comes from the most played artists before the profile's first derivation", () => {
    const opening = djOpeningGrid({
      artists: library,
      taste: null,
      played: [{ id: 2, name: "Tricky", countedPlays: 3 }],
      graph: null,
      artistMixes: chart,
    });
    assert.deepEqual(shown(opening), ["Tricky"]);
  });

  test("switches from the chart to the taste profile with the first signal, the mixes unchanged", () => {
    const before = { artists: library, taste: tasteOf({ Portishead: 0 }), graph: null };
    assert.deepEqual(shown(djOpeningGrid({ ...before, artistMixes: chart })), [
      "Dua Lipa",
      "Bad Bunny",
    ]);
    const after = { ...before, taste: tasteOf({ Portishead: 1 }) };
    assert.deepEqual(shown(djOpeningGrid({ ...after, artistMixes: chart })), ["Portishead"]);
  });
});
