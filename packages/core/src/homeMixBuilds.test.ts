import assert from "node:assert/strict";
import { test } from "node:test";
import { homeMixBuildsDue, discoverMixRowsToBuild } from "./index.ts";

test("a Home visit builds both due mix rows together", () => {
  assert.deepEqual(
    homeMixBuildsDue(
      [
        { id: "artist-mixes", saved: null, building: false, retryAt: null },
        { id: "genre-mixes", saved: null, building: false, retryAt: null },
      ],
      { now: new Date(2026, 9, 23, 12).getTime(), played: true },
    ),
    ["artist-mixes", "genre-mixes"],
  );
});

test("a visit leaves current, running and backoff rows alone, but the first plays make a row due", () => {
  const now = new Date(2026, 9, 23, 12).getTime();
  const saved = { builtAt: now - 1000, playSeeds: true };
  const row = { id: "artist-mixes" as const, saved, building: false, retryAt: null };
  for (const unavailable of [
    row,
    { ...row, saved: null, building: true },
    { ...row, saved: null, retryAt: now + 1 },
  ]) {
    assert.deepEqual(homeMixBuildsDue([unavailable], { now, played: true }), []);
  }
  assert.deepEqual(
    homeMixBuildsDue([{ ...row, saved: { ...saved, playSeeds: false } }], { now, played: true }),
    ["artist-mixes"],
  );
  assert.deepEqual(
    homeMixBuildsDue([{ ...row, saved: null, retryAt: now }], { now, played: false }),
    ["artist-mixes"],
  );
});

test("Artist mixes seeded from the chart alone are due once the Library can seed", () => {
  const now = new Date(2026, 9, 23, 12).getTime();
  const seed = {
    kind: "artist" as const,
    id: "artist:air",
    name: "Air",
    from: "chart" as const,
    browseId: "UC-air",
  };
  const saved = { builtAt: now - 1000, playSeeds: false, build: { seeds: [seed], avoid: [] } };
  const row = { id: "artist-mixes" as const, saved, building: false, retryAt: null };
  assert.deepEqual(homeMixBuildsDue([row], { now, played: false }), []);
  assert.deepEqual(homeMixBuildsDue([row], { now, played: false, librarySeeds: true }), [
    "artist-mixes",
  ]);
});

test("removed mix rows do not build, including after the first counted plays", () => {
  assert.deepEqual(discoverMixRowsToBuild(["magic-queue", "genre-mixes"], { empty: false }), [
    "genre-mixes",
  ]);
  assert.deepEqual(discoverMixRowsToBuild(["magic-queue", "artist-mixes"], { empty: false }), [
    "artist-mixes",
  ]);
  assert.deepEqual(discoverMixRowsToBuild(["magic-queue"], { empty: false }), []);
});

test("an empty Library still builds chart Artist mixes for the shown Magic Queue", () => {
  assert.deepEqual(discoverMixRowsToBuild(["magic-queue", "genre-mixes"], { empty: true }), [
    "artist-mixes",
    "genre-mixes",
  ]);
  assert.deepEqual(discoverMixRowsToBuild(["genre-mixes"], { empty: true }), ["genre-mixes"]);
});

test("daily and first-play scheduling skips removed rows and resumes on add-back", () => {
  const now = new Date(2026, 9, 23, 12).getTime();
  const saved = { builtAt: now - 1000, playSeeds: false };
  const rows = [
    { id: "artist-mixes" as const, saved, building: false, retryAt: null },
    { id: "genre-mixes" as const, saved, building: false, retryAt: null },
  ];
  for (const played of [false, true]) {
    assert.deepEqual(
      homeMixBuildsDue(rows, {
        now: now + 86_400_000,
        played,
        discover: { rows: ["magic-queue"], empty: false },
      }),
      [],
    );
  }
  assert.deepEqual(
    homeMixBuildsDue(rows, {
      now,
      played: true,
      discover: { rows: ["magic-queue", "genre-mixes"], empty: false },
    }),
    ["genre-mixes"],
  );
  assert.deepEqual(
    homeMixBuildsDue(rows, {
      now,
      played: false,
      discover: { rows: ["artist-mixes", "genre-mixes"], empty: false },
    }),
    [],
  );
});
