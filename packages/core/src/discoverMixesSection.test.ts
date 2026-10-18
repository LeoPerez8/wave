import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverMixKeep,
  discoverMixesSection,
  parseDiscoverMixes,
  savedDiscoverMix,
  type DiscoverMixes,
} from "./index.ts";

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
      songs: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => song(id)),
      familiar: [
        { source: "library", track: { id: 1, title: "Roads", artist: "Portishead" } },
        { source: "library", track: { id: 2, title: "Teardrop", artist: "Massive Attack" } },
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
    assert.deepEqual(at(5), ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    assert.deepEqual(at(1), ["a", "b", "c", "d", 1, "e", "f", "g", "h", 2]);
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
    const unreadable = parseDiscoverMixes(
      JSON.stringify({ version: 2, builtAt: 1, mixes: [{ id: 1 }] }),
    );
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

  test("leaves out a mix that blends to fewer than ten songs, and is hidden when none is left", () => {
    const explicitOnes = (mixes: DiscoverMixes): DiscoverMixes => ({
      ...mixes,
      mixes: mixes.mixes.map((mix) => ({
        ...mix,
        songs: mix.songs.map((entry, n) => ({ ...entry, explicit: n > 0 })),
      })),
    });
    const keep = discoverMixKeep({ dontPlayExplicit: true, library: null });
    assert.deepEqual(
      discoverMixesSection(explicitOnes(saved), {
        ytMusic: true,
        nothingToBuildFrom: false,
        blend: { level: 3, keep },
      }),
      { kind: "hidden" },
    );
  });
});

describe("A saved mix's page", () => {
  test("is the mix [id] as the owner's level blends it", () => {
    const mix = savedDiscoverMix(saved, "artist:portishead", { level: 5 });
    assert.equal(mix?.songs.length, 10);
  });

  test("is gone when no saved mix has [id], or when it blends to fewer than ten songs", () => {
    assert.equal(savedDiscoverMix(saved, "artist:massive-attack", blend), null);
    assert.equal(savedDiscoverMix(null, "artist:portishead", blend), null);
    const keep = discoverMixKeep({ dontPlayExplicit: true, library: null });
    const explicit: DiscoverMixes = {
      ...saved,
      mixes: saved.mixes.map((mix) => ({
        ...mix,
        songs: mix.songs.map((entry) => ({ ...entry, explicit: true })),
      })),
    };
    assert.equal(savedDiscoverMix(explicit, "artist:portishead", { level: 3, keep }), null);
  });
});
