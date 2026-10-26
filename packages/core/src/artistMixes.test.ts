import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { artistMixSeedPool, artistMixSeeds, artistMixSimilarSource } from "./index.ts";

const played = (id: number, name: string, countedPlays: number) => ({ id, name, countedPlays });
const library = (id: number, name: string, songCount: number) => ({ id, name, songCount });
const similar = (name: string) => ({ name, browseId: `UC-${name}` });

/** A random source that always answers [value]. */
const always = (value: number) => () => value;

const seedNames = (seeds: ReturnType<typeof artistMixSeeds>) =>
  seeds.map((seed) => `${seed.from}: ${seed.name}`);

const MOST_PLAYED = [
  played(1, "Bad Omens", 600),
  played(2, "Sleep Token", 500),
  played(3, "Spiritbox", 400),
  played(4, "Bring Me the Horizon", 300),
  played(5, "Nothing But Thieves", 200),
  played(6, "Architects", 100),
];

describe("Artist mixes' seeds", () => {
  test("are four of the most played artists, picked by the random source, most played first", () => {
    assert.deepEqual(seedNames(artistMixSeeds({ played: MOST_PLAYED }, always(0))), [
      "plays: Bad Omens",
      "plays: Sleep Token",
      "plays: Spiritbox",
      "plays: Bring Me the Horizon",
    ]);
    assert.deepEqual(seedNames(artistMixSeeds({ played: MOST_PLAYED }, always(0.999_999))), [
      "plays: Spiritbox",
      "plays: Bring Me the Horizon",
      "plays: Nothing But Thieves",
      "plays: Architects",
    ]);
  });

  test("change from build to build, the most played picked more often", () => {
    // A fixed pseudo-random sequence (a linear congruential generator), so the test is the same every run.
    let state = 42;
    const random = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const artists = [
      played(1, "Bad Omens", 900),
      ...Array.from({ length: 19 }, (_, at) => played(at + 2, `Artist ${at + 2}`, 20 - at)),
    ];
    const builds = Array.from({ length: 500 }, () =>
      artistMixSeeds({ played: artists }, random).map((seed) => seed.name),
    );
    const sets = new Set(builds.map((names) => names.join("|")));
    assert.ok(sets.size > 100, `only ${sets.size} different sets of seeds`);
    const picks = (name: string) => builds.filter((names) => names.includes(name)).length;
    assert.ok(picks("Bad Omens") > picks("Artist 2"));
    assert.ok(picks("Artist 2") > picks("Artist 20"));
    assert.ok(picks("Artist 20") > 0);
  });

  test("leave out names that aren't an artist's", () => {
    const seeds = artistMixSeeds(
      {
        played: [
          played(1, "Various Artists", 900),
          played(2, "Sleep Token", 500),
          played(3, "Unknown Artist", 400),
        ],
      },
      always(0),
    );
    assert.deepEqual(seedNames(seeds), ["plays: Sleep Token"]);
  });

  test("with plays for fewer than four, end with the Library's artists with the most songs", () => {
    const seeds = artistMixSeeds(
      {
        played: [played(1, "Sleep Token", 500), played(2, "Spiritbox", 50)],
        library: [
          library(3, "Polaris", 12),
          library(4, "sleep token", 40),
          library(5, "Various Artists", 90),
          library(6, "Architects", 30),
          library(7, "Thornhill", 20),
        ],
      },
      always(0),
    );
    assert.deepEqual(seedNames(seeds), [
      "plays: Sleep Token",
      "plays: Spiritbox",
      "library: Architects",
      "library: Thornhill",
    ]);
  });

  test("take an artist only streamed (no Library id) once their plays rank them", () => {
    const seeds = artistMixSeeds(
      {
        played: [
          { id: "artist:sleep token", name: "Sleep Token", countedPlays: 40 },
          played(2, "Spiritbox", 5),
        ],
        library: [library(2, "Spiritbox", 9), library(3, "Polaris", 12)],
      },
      always(0),
    );
    assert.deepEqual(seedNames(seeds), [
      "plays: Sleep Token",
      "plays: Spiritbox",
      "library: Polaris",
    ]);
    assert.deepEqual(
      artistMixSimilarSource({
        played: [{ id: "artist:sleep token", name: "Sleep Token", countedPlays: 40 }],
        library: [],
      }),
      { id: "artist:sleep token", name: "Sleep Token" },
    );
  });

  test("with nothing played, are the Library's artists with the most songs", () => {
    const seeds = artistMixSeeds(
      {
        played: [],
        library: [library(1, "Polaris", 12), library(2, "Architects", 30)],
      },
      always(0.5),
    );
    assert.deepEqual(seedNames(seeds), ["library: Architects", "library: Polaris"]);
  });

  test("with nothing played and an empty Library, are none", () => {
    assert.deepEqual(artistMixSeeds({ played: [], library: [] }, always(0)), []);
  });
});

describe("Artist mixes' seeds from artists similar to the Library's", () => {
  test("fill the four after the Library's, the pages taking turns, leaving out artists the Library has", () => {
    const seeds = artistMixSeeds(
      {
        played: [played(1, "Sleep Token", 500)],
        library: [library(1, "Sleep Token", 20), library(2, "Spiritbox", 10)],
        similar: [
          {
            of: "Sleep Token",
            artists: [similar("spiritbox"), similar("Bad Omens"), similar("Erra")],
          },
          { of: "Spiritbox", artists: [similar("Bad Omens"), similar("Polaris"), similar("Erra")] },
        ],
      },
      always(0),
    );
    assert.deepEqual(seedNames(seeds), [
      "plays: Sleep Token",
      "library: Spiritbox",
      "similar: Bad Omens",
      "similar: Polaris",
    ]);
    assert.equal(seeds[2]?.browseId, "UC-Bad Omens");
  });

  test("are read from artist pages one at a time while the seeds have room: the most played first, then the Library's with the most songs", () => {
    const pools = {
      played: [played(1, "Sleep Token", 500)],
      library: [library(1, "Sleep Token", 20), library(2, "Spiritbox", 10), library(3, "Erra", 15)],
    };
    assert.deepEqual(artistMixSimilarSource(pools), { id: 1, name: "Sleep Token" });
    const afterOne = {
      ...pools,
      similar: [{ of: "Sleep Token", artists: [] }],
    };
    assert.deepEqual(artistMixSimilarSource(afterOne), { id: 3, name: "Erra" });
  });

  test("stop once the seeds have no room left, or after three pages", () => {
    const pools = {
      played: [played(1, "Sleep Token", 500)],
      library: [library(1, "Sleep Token", 20), library(2, "Spiritbox", 10), library(3, "Erra", 15)],
    };
    assert.equal(
      artistMixSimilarSource({
        ...pools,
        similar: [{ of: "Sleep Token", artists: [similar("Polaris")] }],
      }),
      null,
    );
    assert.equal(
      artistMixSimilarSource({
        ...pools,
        similar: [
          { of: "Sleep Token", artists: [] },
          { of: "Erra", artists: [] },
          { of: "Spiritbox", artists: [] },
        ],
      }),
      null,
    );
  });

  test("aren't looked for when the plays and the Library fill the four, or without the Library", () => {
    assert.equal(
      artistMixSimilarSource({
        played: MOST_PLAYED.slice(0, 2),
        library: [library(7, "Erra", 3), library(8, "Polaris", 2)],
      }),
      null,
    );
    assert.equal(artistMixSimilarSource({ played: [played(1, "Sleep Token", 5)] }), null);
  });

  test("skip names that aren't an artist's", () => {
    assert.deepEqual(
      artistMixSimilarSource({
        played: [played(1, "Various Artists", 500)],
        library: [library(2, "Erra", 15)],
      }),
      { id: 2, name: "Erra" },
    );
  });
});

describe("Artist mixes' seed pool (available seed artists)", () => {
  test("is every played artist, in plays' order", () => {
    assert.deepEqual(seedNames(artistMixSeedPool({ played: MOST_PLAYED })), [
      "plays: Bad Omens",
      "plays: Sleep Token",
      "plays: Spiritbox",
      "plays: Bring Me the Horizon",
      "plays: Nothing But Thieves",
      "plays: Architects",
    ]);
  });

  test("with plays for fewer than four, the Library's artists with the most songs, then similar artists", () => {
    const pool = artistMixSeedPool({
      played: [played(1, "Sleep Token", 500)],
      library: [
        library(1, "Sleep Token", 20),
        library(2, "Spiritbox", 10),
        library(3, "Various Artists", 90),
      ],
      similar: [{ of: "Sleep Token", artists: [similar("Spiritbox"), similar("Bad Omens")] }],
    });
    assert.deepEqual(seedNames(pool), [
      "plays: Sleep Token",
      "library: Spiritbox",
      "similar: Bad Omens",
    ]);
    assert.equal(pool[2]?.browseId, "UC-Bad Omens");
  });

  test("with plays for four or more, no Library artist", () => {
    const pool = artistMixSeedPool({
      played: MOST_PLAYED.slice(0, 4),
      library: [library(9, "Polaris", 40)],
    });
    assert.equal(pool.length, 4);
  });
});
