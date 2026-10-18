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

/** The owner's level. */
const blend = { level: 3 } as const;

/** Mixes saved by an earlier build. */
const saved: DiscoverMixes = {
  builtAt: new Date(2026, 9, 17, 12).getTime(),
  playSeeds: true,
  mixes: [
    {
      id: "artist:portishead",
      seed: { kind: "artist", name: "Portishead" },
      songs: [song("a"), song("b"), song("c"), song("d"), song("e")],
      library: [
        { id: 1, title: "Roads", artist: "Portishead" },
        { id: 2, title: "Teardrop", artist: "Massive Attack" },
      ],
    },
  ],
};

describe("Home's Discover mixes section", () => {
  test("is hidden while YT Music is off, even with mixes saved", () => {
    assert.deepEqual(
      discoverMixesSection(saved, { ytMusic: false, nothingToBuildFrom: false, blend }),
      {
        kind: "hidden",
      },
    );
    assert.deepEqual(
      discoverMixesSection(null, { ytMusic: false, nothingToBuildFrom: false, blend }),
      {
        kind: "hidden",
      },
    );
  });

  test("shows the saved mixes, so a daily rebuild keeps yesterday's until today's are saved", () => {
    const shown = discoverMixesSection(saved, { ytMusic: true, nothingToBuildFrom: false, blend });
    assert.deepEqual(shown.kind === "mixes" && shown.mixes.map((mix) => mix.id), [
      "artist:portishead",
    ]);
    assert.equal(
      discoverMixesSection(saved, { ytMusic: true, nothingToBuildFrom: true, blend }).kind,
      "mixes",
    );
  });

  test("shows the mixes as the owner's level blends them", () => {
    const at = (level: 1 | 5) => {
      const shown = discoverMixesSection(saved, {
        ytMusic: true,
        nothingToBuildFrom: false,
        blend: { level },
      });
      return shown.kind === "mixes"
        ? shown.mixes[0]?.songs.map((entry) =>
            entry.source === "stream" ? entry.song.videoId : entry.track.id,
          )
        : null;
    };
    assert.deepEqual(at(5), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(at(1), ["a", "b", 1, "c", 2]);
  });

  test("shows a skeleton while no mixes are saved: the first build, or after a failed one", () => {
    assert.deepEqual(
      discoverMixesSection(null, { ytMusic: true, nothingToBuildFrom: false, blend }),
      {
        kind: "skeleton",
      },
    );
  });

  test("shows a skeleton when the saved mixes can't be read", () => {
    const unreadable = parseDiscoverMixes(JSON.stringify({ builtAt: 1, mixes: [{ id: 1 }] }));
    assert.deepEqual(
      discoverMixesSection(unreadable, { ytMusic: true, nothingToBuildFrom: false, blend }),
      { kind: "skeleton" },
    );
  });

  test("is hidden when the last build had nothing to build from (no plays, an empty Library)", () => {
    assert.deepEqual(
      discoverMixesSection(null, { ytMusic: true, nothingToBuildFrom: true, blend }),
      {
        kind: "hidden",
      },
    );
  });
});
