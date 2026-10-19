import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverMixesBuilt,
  discoverMixesRerun,
  parseDiscoverMixes,
  rerankedDiscoverMixes,
  storedDiscoverMixes,
  type DiscoverMix,
  type DiscoverMixSeed,
  type DiscoverMixes,
} from "./index.ts";

const song = (videoId: string) => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Tricky"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const mixOf = (seed: DiscoverMixSeed, prefix: string): DiscoverMix => ({
  id: seed.id,
  seed: {
    kind: seed.kind,
    name: seed.name,
    ...(seed.genre === undefined ? {} : { genre: seed.genre }),
    artists: (seed.artists ?? [seed]).map((artist) => artist.name),
  },
  songs: Array.from({ length: 10 }, (_, n) => song(`${prefix}${n}`)),
});

const tricky: DiscoverMixSeed = {
  kind: "artist",
  id: "artist:tricky",
  name: "Tricky",
  from: "similar",
  browseId: "UC123",
};
const portishead: DiscoverMixSeed = {
  kind: "artist",
  id: "artist:portishead",
  name: "Portishead",
  from: "plays",
};
const rock: DiscoverMixSeed = {
  kind: "genre",
  id: "genre:rock",
  name: "Rock",
  from: "plays",
  genre: "Rock",
  artists: [
    { id: 2, name: "Foo Fighters" },
    { id: 3, name: "Pixies" },
  ],
};

const saved = (mixes: DiscoverMixes | null): DiscoverMixes => {
  assert.ok(mixes !== null);
  const read = parseDiscoverMixes(storedDiscoverMixes(mixes));
  assert.ok(read !== null);
  return read;
};

describe("Re-ranking a section's saved mixes", () => {
  test("starts again from the build's seeds, every one, its avoided songs and its variety", () => {
    // Portishead's seed made no mix; a re-rank at other sliders may make one.
    const built = saved(
      discoverMixesBuilt([mixOf(tricky, "t"), mixOf(rock, "r")], 1000, [tricky, portishead, rock], {
        avoid: new Set(["old1", "old2"]),
        variety: 42,
      }),
    );
    assert.deepEqual(discoverMixesRerun(built, []), {
      seeds: [tricky, portishead, rock],
      avoid: new Set(["old1", "old2"]),
      variety: 42,
    });
  });

  test("mixes saved before builds kept their seeds start from the mixes', a genre mix's artists found in the Library", () => {
    const old = saved({
      builtAt: 1000,
      playSeeds: true,
      mixes: [mixOf(tricky, "t"), mixOf(rock, "r")],
    });
    const rerun = discoverMixesRerun(old, [
      { id: 3, name: "Pixies" },
      { id: 2, name: "foo fighters" },
    ]);
    assert.deepEqual(
      rerun.seeds.map((seed) => [seed.id, seed.kind, seed.name, seed.genre, seed.artists]),
      [
        ["artist:tricky", "artist", "Tricky", undefined, undefined],
        [
          "genre:rock",
          "genre",
          "Rock",
          "Rock",
          // The Library's artists, as it names them.
          [
            { id: 2, name: "foo fighters" },
            { id: 3, name: "Pixies" },
          ],
        ],
      ],
    );
    assert.deepEqual(rerun.avoid, new Set());
    assert.equal(rerun.variety, undefined);
  });

  test("saves the re-ranked mixes as the same build; one that made none keeps the saved", () => {
    const built = saved(
      discoverMixesBuilt([mixOf(tricky, "t")], 1000, [tricky, portishead], { variety: 1 }),
    );
    const again = rerankedDiscoverMixes(built, [mixOf(portishead, "p")]);
    assert.deepEqual(
      again.mixes.map((mix) => mix.id),
      ["artist:portishead"],
    );
    assert.equal(again.builtAt, 1000);
    assert.equal(again.playSeeds, true);
    assert.deepEqual(discoverMixesRerun(saved(again), []).seeds, [tricky, portishead]);
    assert.equal(rerankedDiscoverMixes(built, []), built);
  });
});
