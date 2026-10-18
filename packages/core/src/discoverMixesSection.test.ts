import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { discoverMixesSection, parseDiscoverMixes, type DiscoverMixes } from "./index.ts";

const song = (videoId: string) => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Portishead"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

/** Mixes saved by an earlier build. */
const saved: DiscoverMixes = {
  builtAt: new Date(2026, 9, 17, 12).getTime(),
  playSeeds: true,
  mixes: [
    {
      id: "artist:portishead",
      seed: { kind: "artist", name: "Portishead" },
      songs: [song("a"), song("b")],
    },
  ],
};

describe("Home's Discover mixes section", () => {
  test("is hidden while YT Music is off, even with mixes saved", () => {
    assert.deepEqual(discoverMixesSection(saved, { ytMusic: false, nothingToBuildFrom: false }), {
      kind: "hidden",
    });
    assert.deepEqual(discoverMixesSection(null, { ytMusic: false, nothingToBuildFrom: false }), {
      kind: "hidden",
    });
  });

  test("shows the saved mixes, so a daily rebuild keeps yesterday's until today's are saved", () => {
    assert.deepEqual(discoverMixesSection(saved, { ytMusic: true, nothingToBuildFrom: false }), {
      kind: "mixes",
      mixes: saved.mixes,
    });
    assert.deepEqual(discoverMixesSection(saved, { ytMusic: true, nothingToBuildFrom: true }), {
      kind: "mixes",
      mixes: saved.mixes,
    });
  });

  test("shows a skeleton while no mixes are saved: the first build, or after a failed one", () => {
    assert.deepEqual(discoverMixesSection(null, { ytMusic: true, nothingToBuildFrom: false }), {
      kind: "skeleton",
    });
  });

  test("shows a skeleton when the saved mixes can't be read", () => {
    const unreadable = parseDiscoverMixes(JSON.stringify({ builtAt: 1, mixes: [{ id: 1 }] }));
    assert.deepEqual(
      discoverMixesSection(unreadable, { ytMusic: true, nothingToBuildFrom: false }),
      { kind: "skeleton" },
    );
  });

  test("is hidden when the last build had nothing to build from (no plays, an empty Library)", () => {
    assert.deepEqual(discoverMixesSection(null, { ytMusic: true, nothingToBuildFrom: true }), {
      kind: "hidden",
    });
  });
});
