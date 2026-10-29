import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  REAL_SHUFFLE,
  currentEntry,
  queueHistory,
  readShuffleKind,
  reduceQueue,
  shuffledTrackIds,
  shufflesQueue,
  upNext,
} from "./index.ts";
import type { QueueCommand, QueueState, Shuffle } from "./index.ts";

const songs = { kind: "songs", id: null } as const;

/** A deterministic random source (Park–Miller), so shuffles are repeatable. */
const seeded = (seed: number): (() => number) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 13);

const ids = (entries: readonly { trackId: string }[]): string[] =>
  entries.map((entry) => entry.trackId);

/** Plays [trackIds] from the Songs context, in order, from [startIndex]. */
const start = (trackIds: readonly string[], startIndex = 0): QueueState =>
  reduceQueue(EMPTY_QUEUE, { type: "play", trackIds, startIndex, context: songs }).state;

const smart = (plays: Record<string, number>): Shuffle => ({
  kind: "smart",
  plays: new Map(Object.entries(plays)),
});

const run = (state: QueueState, command: QueueCommand, seed: number, shuffle?: Shuffle) =>
  reduceQueue(state, command, seeded(seed), shuffle);

/** The longest stretch of consecutive songs [inGroup] says belong to one group. */
const longestRun = (trackIds: readonly string[], inGroup: (id: string) => boolean): number => {
  let longest = 0;
  let current = 0;
  for (const id of trackIds) {
    current = inGroup(id) ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
};

describe("Real Shuffle", () => {
  const tracks = "a b c d e f g h i j".split(" ");

  // The orders the queue gave these seeds before Smart Shuffle existed. Turning
  // shuffle on then shuffled the nine songs after the current one ("c h i j f g d
  // b e a" from c, of a b d…j); it now shuffles Up Next's nine (b…j, from a) alike.
  test("turning shuffle on gives today's order", () => {
    const { state } = run(start(tracks), { type: "setShuffle", on: true }, 3, REAL_SHUFFLE);
    assert.equal(ids(state.entries).join(" "), "a h i j f g d c e b");
    assert.equal(state.index, 0);
  });

  test("a Shuffle button gives today's order", () => {
    const { state } = run(
      EMPTY_QUEUE,
      { type: "play", trackIds: tracks, context: songs, shuffle: true },
      5,
      REAL_SHUFFLE,
    );
    assert.equal(ids(state.entries).join(" "), "a i j c f b e d h g");
  });

  test("is the kind the queue uses when none is given", () => {
    const { state } = run(start(tracks), { type: "setShuffle", on: true }, 3);
    assert.equal(ids(state.entries).join(" "), "a h i j f g d c e b");
  });
});

/** In these tests the most played songs are named h…, played ones among never-played ones p…. */
const most = (id: string): boolean => id.startsWith("h");
const played = (id: string): boolean => id.startsWith("p");

describe("Smart Shuffle", () => {
  // h1–h4 are played most, l1–l4 a little or never.
  const plays = { h1: 40, h2: 31, h3: 25, h4: 12, l1: 2, l2: 1 };
  const tracks = ["c", "h1", "h2", "h3", "h4", "l1", "l2", "l3", "l4"];

  test("alternates the most played songs with the less played ones after the current song", () => {
    for (const seed of SEEDS) {
      const { state } = run(start(tracks), { type: "setShuffle", on: true }, seed, smart(plays));
      assert.equal(currentEntry(state)?.trackId, "c");
      const rest = ids(upNext(state));
      assert.deepEqual(rest.toSorted(), tracks.slice(1).toSorted());
      assert.equal(longestRun(rest, most), 1, `seed ${seed}: ${rest.join(" ")}`);
      assert.equal(
        longestRun(rest, (id) => !most(id)),
        1,
        `seed ${seed}: ${rest.join(" ")}`,
      );
    }
  });

  test("keeps History and the current song, and interleaves only Up Next", () => {
    const history = ["p1", "n1"];
    for (const seed of SEEDS) {
      const { state } = run(
        start([...history, ...tracks], 2),
        { type: "setShuffle", on: true },
        seed,
        smart({ ...plays, p1: 50 }),
      );
      assert.deepEqual(ids(queueHistory(state)), history);
      assert.equal(currentEntry(state)?.trackId, "c");
      const rest = ids(upNext(state));
      assert.deepEqual(rest.toSorted(), tracks.slice(1).toSorted());
      assert.equal(longestRun(rest, most), 1, `seed ${seed}: ${rest.join(" ")}`);
    }
  });

  test("spreads a few played songs evenly among many never-played ones", () => {
    // 3 played songs among 12: one in every 4, from wherever the order starts.
    const others = ["p1", "p2", "p3", ...Array.from({ length: 9 }, (_, i) => `n${i}`)];
    for (const seed of SEEDS) {
      const { state } = run(
        start(["c", ...others]),
        { type: "setShuffle", on: true },
        seed,
        smart({ p1: 3, p2: 2, p3: 1 }),
      );
      const rest = ids(upNext(state));
      assert.equal(longestRun(rest, played), 1, `seed ${seed}: ${rest.join(" ")}`);
      assert.ok(longestRun(rest, (id) => !played(id)) <= 4, `seed ${seed}: ${rest.join(" ")}`);
      // In every stretch from the start, the played songs keep their share (1 in 4), give or take one.
      rest.forEach((_, i) => {
        const count = rest.slice(0, i + 1).filter(played).length;
        assert.ok(Math.abs(count - (i + 1) / 4) < 1, `seed ${seed}: ${rest.join(" ")}`);
      });
    }
  });

  test("puts the songs with the most plays on the most played side", () => {
    // Ten songs: the five with the most plays alternate with the other five.
    const counts = { a: 90, b: 70, c: 50, d: 30, e: 20, f: 9, g: 5, h: 3, i: 1 };
    const top = new Set(["a", "b", "c", "d", "e"]);
    for (const seed of SEEDS) {
      const { state } = run(
        start(["now", ...Object.keys(counts), "j"]),
        { type: "setShuffle", on: true },
        seed,
        smart(counts),
      );
      const rest = ids(upNext(state));
      assert.equal(
        longestRun(rest, (id) => top.has(id)),
        1,
        `seed ${seed}: ${rest.join(" ")}`,
      );
      assert.equal(
        longestRun(rest, (id) => !top.has(id)),
        1,
        `seed ${seed}: ${rest.join(" ")}`,
      );
    }
  });

  test("orders each side at random", () => {
    const orders = new Set(
      SEEDS.map((seed) =>
        ids(
          upNext(run(start(tracks), { type: "setShuffle", on: true }, seed, smart(plays)).state),
        ).join(" "),
      ),
    );
    assert.ok(orders.size > SEEDS.length / 2);
    const firsts = new Set(
      SEEDS.map((seed) => {
        const rest = upNext(
          run(start(tracks), { type: "setShuffle", on: true }, seed, smart(plays)).state,
        );
        return ids(rest).find(most);
      }),
    );
    assert.deepEqual([...firsts].toSorted(), ["h1", "h2", "h3", "h4"]);
  });

  test("mixes the lined-up songs in with the rest", () => {
    const queued = reduceQueue(start(tracks), { type: "addToQueue", trackIds: ["x", "y"] }).state;
    const spots = new Set(
      SEEDS.map((seed) => {
        const { state } = run(queued, { type: "setShuffle", on: true }, seed, smart(plays));
        return ids(upNext(state)).indexOf("x");
      }),
    );
    assert.ok(!spots.has(-1));
    assert.ok(spots.size > 1);
  });

  test("a Shuffle button interleaves the whole list, the first song included", () => {
    const list = tracks.slice(1);
    for (const seed of SEEDS) {
      const { state } = run(
        EMPTY_QUEUE,
        { type: "play", trackIds: list, context: songs, shuffle: true },
        seed,
        smart(plays),
      );
      assert.equal(state.index, 0);
      assert.equal(state.shuffle, true);
      const order = ids(state.entries);
      assert.deepEqual(order.toSorted(), list.toSorted());
      assert.equal(longestRun(order, most), 1, `seed ${seed}: ${order.join(" ")}`);
      assert.equal(
        longestRun(order, (id) => !most(id)),
        1,
        `seed ${seed}: ${order.join(" ")}`,
      );
    }
  });

  test("a tapped song with shuffle on plays first, the rest interleaved after it", () => {
    const { state } = run(
      EMPTY_QUEUE,
      { type: "play", trackIds: tracks, startIndex: 0, context: songs, shuffle: true },
      9,
      smart(plays),
    );
    assert.equal(currentEntry(state)?.trackId, "c");
    assert.equal(longestRun(ids(upNext(state)), most), 1);
  });

  test("turning it off restores the context's order", () => {
    const shuffled = run(start(tracks, 3), { type: "setShuffle", on: true }, 5, smart(plays)).state;
    const { state } = reduceQueue(shuffled, { type: "setShuffle", on: false });
    assert.deepEqual(ids(state.entries), tracks);
    assert.equal(currentEntry(state)?.trackId, "h3");
  });

  test("choosing it while shuffled reshuffles Up Next the smart way", () => {
    const realShuffled = run(start(tracks), { type: "setShuffle", on: true }, 2).state;
    const queued = reduceQueue(realShuffled, { type: "playNext", trackIds: ["x"] }).state;
    for (const seed of SEEDS) {
      const { state, playback } = run(queued, { type: "reshuffle" }, seed, smart(plays));
      assert.equal(state.shuffle, true);
      assert.equal(playback, "keep");
      assert.equal(currentEntry(state)?.key, currentEntry(queued)?.key);
      const rest = ids(upNext(state));
      assert.ok(rest.includes("x"));
      assert.equal(longestRun(rest, most), 1, `seed ${seed}: ${rest.join(" ")}`);
    }
  });

  test("choosing a kind with shuffle off turns shuffle on", () => {
    const { state } = run(start(tracks), { type: "reshuffle" }, 4, smart(plays));
    assert.equal(state.shuffle, true);
    assert.equal(currentEntry(state)?.trackId, "c");
    assert.equal(longestRun(ids(upNext(state)), most), 1);
  });
});

describe("shufflesQueue", () => {
  const playing = start(["a", "b", "c"]);
  const shuffled = reduceQueue(playing, { type: "setShuffle", on: true }).state;

  test("says which commands shuffle, so play counts are read only for those", () => {
    assert.equal(shufflesQueue(playing, { type: "setShuffle", on: true }), true);
    assert.equal(shufflesQueue(shuffled, { type: "setShuffle", on: true }), false);
    assert.equal(shufflesQueue(shuffled, { type: "setShuffle", on: false }), false);
    assert.equal(shufflesQueue(shuffled, { type: "reshuffle" }), true);
    assert.equal(shufflesQueue(playing, { type: "next" }), false);
  });

  test("a play shuffles when it asks to, or when shuffle is on", () => {
    const play = { type: "play", trackIds: ["x", "y"], context: songs } as const;
    assert.equal(shufflesQueue(playing, play), false);
    assert.equal(shufflesQueue(shuffled, play), true);
    assert.equal(shufflesQueue(playing, { ...play, shuffle: true }), true);
    assert.equal(shufflesQueue(shuffled, { ...play, shuffle: false }), false);
  });
});

describe("shuffledTrackIds", () => {
  const playing = start(["1", "2", "yt:abc", "3", "2"]);

  test("a play orders the songs it plays, streamed ones included: only their plays are read", () => {
    const play = { type: "play", trackIds: ["7", "yt:x", "8", "7"], context: songs } as const;
    assert.deepEqual(shuffledTrackIds(playing, { ...play, shuffle: true }), ["7", "yt:x", "8"]);
  });

  test("turning shuffle on or reshuffling orders the queue's songs, each once", () => {
    assert.deepEqual(shuffledTrackIds(playing, { type: "setShuffle", on: true }), [
      "1",
      "2",
      "yt:abc",
      "3",
    ]);
    assert.deepEqual(shuffledTrackIds(playing, { type: "reshuffle" }), ["1", "2", "yt:abc", "3"]);
  });

  test("History's songs aren't ordered: only the current song's and Up Next's are", () => {
    const later = start(["1", "2", "yt:abc", "3", "4"], 2);
    assert.deepEqual(shuffledTrackIds(later, { type: "setShuffle", on: true }), ["yt:abc", "3", "4"]);
    assert.deepEqual(shuffledTrackIds(later, { type: "reshuffle" }), ["yt:abc", "3", "4"]);
  });

  test("a command that doesn't shuffle needs no plays", () => {
    assert.deepEqual(shuffledTrackIds(playing, { type: "next" }), []);
  });

  test("a streamed song weighs by its counted plays as a Library song with as many does", () => {
    // The streamed h2 is played as much as the Library's h1: both go on the most played side.
    const tracks = ["c", "1", "yt:h2", "l1", "l2"];
    const plays = { 1: 12, "yt:h2": 12, l1: 1 };
    for (const seed of SEEDS) {
      const { state } = run(start(tracks), { type: "setShuffle", on: true }, seed, smart(plays));
      const rest = ids(upNext(state));
      assert.equal(
        longestRun(rest, (id) => id === "1" || id === "yt:h2"),
        1,
        `seed ${seed}: ${rest.join(" ")}`,
      );
    }
  });
});

describe("readShuffleKind", () => {
  test("reads the saved kind, Real Shuffle by default", () => {
    assert.equal(readShuffleKind("smart"), "smart");
    assert.equal(readShuffleKind("real"), "real");
    assert.equal(readShuffleKind(null), "real");
    assert.equal(readShuffleKind("something else"), "real");
  });
});
