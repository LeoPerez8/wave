import assert from "node:assert/strict";
import { test } from "node:test";

import { PLACEHOLDERS, playingOffView, queueSlots, slotOf } from "./queueSlots.ts";

const plain = { seed: null, status: "idle" } as const;
const placeholders = Array.from({ length: PLACEHOLDERS }, () => ({ kind: "placeholder" }));

test("History, the playing song and Up Next each sit under their heading", () => {
  assert.deepEqual(queueSlots(1, 3, plain), [
    { kind: "historyHead" },
    { kind: "row", at: 0 },
    { kind: "nowPlayingHead" },
    { kind: "row", at: 1 },
    { kind: "upNext", count: 1, seed: null },
    { kind: "row", at: 2 },
  ]);
  assert.deepEqual(queueSlots(0, 0, plain), []);
});

test("Up Next's heading counts its songs and names a Magic Queue's seed", () => {
  const slots = queueSlots(0, 4, { seed: "Pink Moon", status: "idle" });
  assert.deepEqual(slots[2], { kind: "upNext", count: 3, seed: "Pink Moon" });
});

test("an empty Up Next says so", () => {
  assert.deepEqual(queueSlots(0, 1, plain).slice(2), [
    { kind: "upNext", count: 0, seed: null },
    { kind: "note", note: "nothingUpNext" },
  ]);
});

test("placeholder rows stand where a Magic Queue's batch will land", () => {
  const loading = { seed: "Pink Moon", status: "loading" } as const;
  assert.deepEqual(queueSlots(0, 1, loading).slice(3), placeholders);
  assert.deepEqual(queueSlots(0, 2, loading).slice(3), [{ kind: "row", at: 1 }, ...placeholders]);
});

test("a batch that came back empty, or failed, says so under Up Next", () => {
  assert.deepEqual(queueSlots(0, 1, { seed: "Pink Moon", status: "empty" }).slice(3), [
    { kind: "note", note: "noSongsFound" },
  ]);
  assert.deepEqual(queueSlots(0, 2, { seed: "Pink Moon", status: "failed" }).slice(3), [
    { kind: "row", at: 1 },
    { kind: "note", note: "couldntLoad" },
  ]);
});

test("a Magic Queue state means nothing once no Magic Queue plays", () => {
  assert.deepEqual(queueSlots(0, 1, { seed: null, status: "loading" }).slice(3), [
    { kind: "note", note: "nothingUpNext" },
  ]);
});

test("each queue row's slot is where the slots put it", () => {
  for (const [index, length] of [
    [0, 3],
    [1, 3],
    [2, 3],
  ] as const) {
    const slots = queueSlots(index, length, plain);
    for (let at = 0; at < length; at++)
      assert.deepEqual(slots[slotOf(at, index)], { kind: "row", at });
  }
});

test("the playing row is off view above or below the scrolled list, or in view", () => {
  // Rows of 48: the playing one at 96 to 144.
  assert.equal(playingOffView(96, 48, 0, 400), null);
  assert.equal(playingOffView(96, 48, 120, 400), null);
  assert.equal(playingOffView(96, 48, 144, 400), "up");
  assert.equal(playingOffView(96, 48, 0, 96), "down");
  // Before the list is laid out there is nothing to bring back.
  assert.equal(playingOffView(96, 48, 0, 0), null);
});
