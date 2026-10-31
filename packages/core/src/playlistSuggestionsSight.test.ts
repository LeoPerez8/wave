import assert from "node:assert/strict";
import { test } from "node:test";

import {
  playlistSuggestionsSightLine,
  playlistSuggestionsSightWatch,
  type PlaylistSuggestionsSightTiming,
} from "./index.ts";

test("the wait from the section coming into sight reads as one log line with its parts", () => {
  const parts = { settleMs: 1_200.4, readMs: 899.6, rankMs: 150 };
  assert.equal(
    playlistSuggestionsSightLine({ ms: 2_410.2, ...parts, offers: 5, failed: false }),
    "Playlist suggestions in sight: 5 offers after 2410 ms (settle 1200 ms, read 900 ms, rank 150 ms)",
  );
  assert.equal(
    playlistSuggestionsSightLine({
      ms: 0,
      settleMs: 0,
      readMs: 0,
      rankMs: 0,
      offers: 1,
      failed: false,
    }),
    "Playlist suggestions in sight: 1 offer after 0 ms (settle 0 ms, read 0 ms, rank 0 ms)",
  );
  assert.equal(
    playlistSuggestionsSightLine({
      ms: 8_000,
      settleMs: 0,
      readMs: 8_000,
      rankMs: 0,
      offers: 0,
      failed: true,
    }),
    "Playlist suggestions in sight: failed after 8000 ms (settle 0 ms, read 8000 ms, rank 0 ms)",
  );
});

/** A watch on a hand-moved clock, with what it reported. */
const watching = () => {
  let clock = 0;
  const reported: PlaylistSuggestionsSightTiming[] = [];
  const watch = playlistSuggestionsSightWatch({
    now: () => clock,
    report: (timing) => reported.push(timing),
  });
  return {
    watch,
    reported,
    pass: (ms: number) => {
      clock += ms;
    },
    at: () => clock,
  };
};

test("with the section in sight from the start, the wait holds every part", () => {
  const { watch, reported, pass } = watching();
  watch.inSight();
  watch.waiting("settle");
  pass(3_000);
  watch.waiting("read");
  pass(900);
  watch.waiting(null);
  pass(30);
  watch.waiting("rank");
  pass(70);
  watch.waiting(null);
  pass(16);
  assert.deepEqual(reported, []);
  watch.shown({ offers: 5, failed: false });
  assert.deepEqual(reported, [
    { ms: 4_016, settleMs: 3_000, readMs: 900, rankMs: 70, offers: 5, failed: false },
  ]);
});

test("the wait counts nothing from before the section came into sight", () => {
  const { watch, reported, pass } = watching();
  watch.waiting("settle");
  pass(3_000);
  watch.waiting("read");
  pass(500);
  watch.inSight();
  pass(400);
  watch.waiting("rank");
  pass(100);
  watch.waiting(null);
  watch.shown({ offers: 5, failed: false });
  assert.deepEqual(reported, [
    { ms: 500, settleMs: 0, readMs: 400, rankMs: 100, offers: 5, failed: false },
  ]);
});

test("offers already showing when the section comes into sight log as 0 ms, once", () => {
  const { watch, reported, pass } = watching();
  watch.waiting("settle");
  pass(3_000);
  watch.waiting("read");
  pass(1_000);
  watch.waiting(null);
  watch.shown({ offers: 3, failed: false });
  pass(20_000);
  assert.deepEqual(reported, []);
  watch.inSight();
  const zero = { ms: 0, settleMs: 0, readMs: 0, rankMs: 0, offers: 3, failed: false };
  assert.deepEqual(reported, [zero]);
  // A renewal later on, or the section back in sight, isn't this wait again.
  watch.waiting("read");
  pass(1_000);
  watch.shown({ offers: 5, failed: false });
  watch.inSight();
  assert.deepEqual(reported, [zero]);
});

test("sight noticed earlier than it was delivered counts from when it was noticed", () => {
  const { watch, reported, pass, at } = watching();
  watch.waiting("rank");
  pass(1_000);
  const noticed = at();
  pass(200);
  watch.waiting(null);
  watch.shown({ offers: 5, failed: false });
  pass(300);
  watch.inSight(noticed);
  assert.deepEqual(reported, [
    { ms: 200, settleMs: 0, readMs: 0, rankMs: 200, offers: 5, failed: false },
  ]);
});

test("a failure ends the wait as offers do, and says so", () => {
  const { watch, reported, pass } = watching();
  watch.inSight();
  watch.waiting("read");
  pass(8_000);
  watch.shown({ offers: 0, failed: true });
  assert.deepEqual(reported, [
    { ms: 8_000, settleMs: 0, readMs: 8_000, rankMs: 0, offers: 0, failed: true },
  ]);
});

test("a renewal cancelled and started over adds its parts to the same wait", () => {
  const { watch, reported, pass } = watching();
  watch.inSight();
  watch.waiting("settle");
  pass(100);
  watch.waiting("read");
  pass(200);
  watch.waiting("settle");
  pass(100);
  watch.waiting("read");
  pass(300);
  watch.shown({ offers: 5, failed: false });
  assert.deepEqual(reported, [
    { ms: 700, settleMs: 200, readMs: 500, rankMs: 0, offers: 5, failed: false },
  ]);
});

test("the screen hidden during the wait starts it over when the section is back in sight", () => {
  const { watch, reported, pass } = watching();
  watch.inSight();
  watch.waiting("settle");
  pass(500);
  watch.hidden();
  pass(60_000);
  watch.inSight();
  watch.waiting("settle");
  pass(100);
  watch.waiting("read");
  pass(300);
  watch.shown({ offers: 5, failed: false });
  assert.deepEqual(reported, [
    { ms: 400, settleMs: 100, readMs: 300, rankMs: 0, offers: 5, failed: false },
  ]);
});
