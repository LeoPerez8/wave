import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  finishSteps,
  MAGIC_QUEUE_PAGES,
  magicQueuePages,
  magicQueuePopularitySteps,
  redrawMagicQueuePage,
  type CatalogSong,
  type MagicQueuePagesPool,
  type MagicQueueSeedId,
  type RandomSource,
} from "./index.ts";

/** A seeded random source (mulberry32): the same draws on every run. */
const seeded = (seed: number): RandomSource => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const range = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, place) => from + place);

/** Songs 1–[played] played, the next [fresh] never played. */
const library = (played: number, fresh: number): MagicQueuePagesPool => ({
  trackIds: range(1, played + fresh),
  videoIds: [],
  played: new Set(range(1, played)),
});

const unplayed = (pool: MagicQueuePagesPool, page: readonly MagicQueueSeedId[]): number =>
  page.filter((id) => !(pool.played?.has(id) ?? false)).length;

const draw = (level: 1 | 2 | 3 | 4 | 5, popularity: 1 | 2 | 3 | 4 | 5 = 3, seed = 1) => ({
  level,
  popularity,
  random: seeded(seed),
});

describe("magicQueuePages", () => {
  test("three pages of nine, no song twice across the 27", () => {
    const pool = library(40, 40);
    const pages = magicQueuePages(pool, draw(3));
    assert.equal(MAGIC_QUEUE_PAGES, 3);
    assert.deepEqual(
      pages.map((page) => page.length),
      [9, 9, 9],
    );
    assert.equal(new Set(pages.flat()).size, 27);
  });

  test("each page's never-played share follows New music, 20% to 100%", () => {
    const pool = library(40, 40);
    const shares = ([1, 2, 3, 4, 5] as const).map((level) =>
      magicQueuePages(pool, draw(level)).map((page) => unplayed(pool, page)),
    );
    assert.deepEqual(shares, [
      [2, 2, 2],
      [4, 4, 4],
      [5, 5, 5],
      [7, 7, 7],
      [9, 9, 9],
    ]);
  });

  test("when the never-played or the played songs run short, the others fill the page", () => {
    const fewNew = library(30, 3);
    assert.deepEqual(
      magicQueuePages(fewNew, draw(5)).map((page) => [page.length, unplayed(fewNew, page)]),
      [
        [9, 3],
        [9, 0],
        [9, 0],
      ],
    );
    const allNew = library(0, 30);
    assert.deepEqual(
      magicQueuePages(allNew, draw(1)).map((page) => page.length),
      [9, 9, 9],
    );
  });

  test("Popularity favours hits at one end and deep cuts at the other", () => {
    // Songs 1–20 are hits, 21–40 deep cuts, all played.
    const pool: MagicQueuePagesPool = {
      trackIds: range(1, 40),
      videoIds: [],
      played: new Set(range(1, 40)),
      popularityOf: (id) => (typeof id === "number" && id <= 20 ? 1 : 0),
    };
    const hitsOnFirstPage = (step: 1 | 3 | 5): number => {
      let hits = 0;
      for (let seed = 1; seed <= 200; seed++)
        hits += magicQueuePages(pool, draw(3, step, seed))[0]!.filter(
          (id) => typeof id === "number" && id <= 20,
        ).length;
      return hits / (200 * 9);
    };
    assert.ok(hitsOnFirstPage(1) > 0.75, `hits ${hitsOnFirstPage(1)}`);
    assert.ok(hitsOnFirstPage(5) < 0.25, `hits ${hitsOnFirstPage(5)}`);
    const balanced = hitsOnFirstPage(3);
    assert.ok(balanced > 0.4 && balanced < 0.6, `hits ${balanced}`);
  });

  test("a small pool fills the pages in order and leaves out a page with fewer than three", () => {
    assert.deepEqual(
      magicQueuePages(library(10, 10), draw(3)).map((page) => page.length),
      [9, 9],
    );
    assert.deepEqual(
      magicQueuePages(library(11, 10), draw(3)).map((page) => page.length),
      [9, 9, 3],
    );
    assert.deepEqual(
      magicQueuePages(library(2, 0), draw(3)).map((page) => page.length),
      [2],
    );
    assert.deepEqual(magicQueuePages(library(0, 0), draw(3)), []);
  });

  test("playlist entries are drawn with the Library's songs, and disliked ones never", () => {
    const pool: MagicQueuePagesPool = {
      trackIds: [1, 2],
      videoIds: ["a", "b", "c"],
      disliked: new Set(["2", "yt:b"]),
    };
    assert.deepEqual(magicQueuePages(pool, draw(5)).flat().map(String).toSorted(), ["1", "a", "c"]);
  });

  test("kept pages keep their surviving songs in their places and refill the others", () => {
    const pool = library(40, 40);
    const before = magicQueuePages(pool, draw(3));
    const gone = before[1]![4]!;
    const after = magicQueuePages(
      { ...pool, trackIds: pool.trackIds.filter((id) => id !== gone) },
      draw(3, 3, 7),
      before,
    );
    assert.deepEqual(after[0], before[0]);
    assert.deepEqual(after[2], before[2]);
    assert.deepEqual(
      after[1]!.filter((_, place) => place !== 4),
      before[1]!.filter((_, place) => place !== 4),
    );
    assert.notEqual(after[1]![4], gone);
    assert.equal(new Set(after.flat()).size, 27);
  });

  test("a kept page left too short takes later pages' songs, so no page moves", () => {
    const before = [range(1, 9), range(10, 9), range(19, 9)];
    // Seven songs of the middle page leave the pool, and nothing new is left to fill them.
    const pool: MagicQueuePagesPool = {
      trackIds: [...range(1, 9), 10, 11, ...range(19, 9)],
      videoIds: [],
    };
    const after = magicQueuePages(pool, draw(3), before);
    assert.deepEqual(after[0], before[0]);
    assert.deepEqual(after[1]!.slice(0, 2), [10, 11]);
    assert.deepEqual(
      after.map((page) => page.length),
      [9, 9],
    );
    assert.equal(new Set(after.flat()).size, 18);
  });

  test("an emptied first page takes later pages' songs rather than the second moving up", () => {
    const before = [range(1, 9), range(10, 9), range(19, 9)];
    const pool: MagicQueuePagesPool = { trackIds: range(10, 18), videoIds: [] };
    const after = magicQueuePages(pool, draw(3), before);
    assert.deepEqual(after[1], before[1]);
    assert.deepEqual(
      after.map((page) => page.length),
      [9, 9],
    );
    assert.deepEqual(new Set(after[0]), new Set(before[2]));
  });
});

describe("redrawMagicQueuePage", () => {
  test("draws only the page in sight again, with songs no page shows", () => {
    const pool = library(40, 40);
    const pages = magicQueuePages(pool, draw(3));
    const redrawn = redrawMagicQueuePage(pool, draw(3, 3, 9), pages, 1);
    assert.deepEqual(redrawn[0], pages[0]);
    assert.deepEqual(redrawn[2], pages[2]);
    assert.equal(redrawn[1]!.length, 9);
    assert.equal(
      redrawn[1]!.filter((id) => pages.flat().includes(id)).length,
      0,
      "the page brings songs none of the pages showed",
    );
    assert.equal(unplayed(pool, redrawn[1]!), 5);
  });

  test("the levels as they are now apply to the redrawn page", () => {
    const pool = library(40, 40);
    const pages = magicQueuePages(pool, draw(1));
    const redrawn = redrawMagicQueuePage(pool, draw(5), pages, 0);
    assert.equal(unplayed(pool, pages[0]!), 2);
    assert.equal(unplayed(pool, redrawn[0]!), 9);
  });

  test("with too few other songs, the page takes its own songs back to stay full", () => {
    const pool = library(12, 0);
    const pages = magicQueuePages(pool, draw(3));
    assert.deepEqual(
      pages.map((page) => page.length),
      [9, 3],
    );
    const redrawn = redrawMagicQueuePage(pool, draw(3, 3, 4), pages, 0);
    assert.deepEqual(redrawn[1], pages[1]);
    assert.equal(redrawn[0]!.length, 9);
    assert.equal(new Set(redrawn.flat()).size, 12);
  });
});

describe("magicQueuePopularitySteps", () => {
  const catalogSong = (videoId: string, radios: number): CatalogSong => ({
    song: {
      videoId,
      title: `Song ${videoId}`,
      artists: ["Someone"],
      album: null,
      albumId: null,
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
    },
    firstSeenAt: 0,
    lastSeenAt: 0,
    radios: Array.from({ length: radios }, (_, place) => ({
      seed: `artist ${place}`,
      seedName: `Artist ${place}`,
      lastSeenAt: 0,
    })),
  });

  test("a song more radios carry is more of a hit; one no radio brought is a deep cut", () => {
    const popularity = finishSteps(
      magicQueuePopularitySteps(
        [catalogSong("one", 1), catalogSong("three", 3), catalogSong("none", 0)],
        () => null,
      ),
    );
    assert.equal(popularity("one"), 0.5);
    assert.equal(popularity("three"), 0.875);
    assert.equal(popularity("none"), 0);
    assert.equal(popularity("unknown"), 0);
    assert.equal(popularity(7), 0);
  });

  test("a Library song takes the popularity of the catalog song it is", () => {
    const popularity = finishSteps(
      magicQueuePopularitySteps([catalogSong("a", 1), catalogSong("b", 2)], (song) =>
        song.videoId === "a" || song.videoId === "b" ? { id: 7 } : null,
      ),
    );
    assert.equal(popularity(7), 0.75, "the higher of the two recordings it matches");
  });
});
