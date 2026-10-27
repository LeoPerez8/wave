import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE, reduceQueue } from "./queue.ts";
import { queuePersistence } from "./queuePersistence.ts";

const state = reduceQueue(EMPTY_QUEUE, {
  type: "play", trackIds: ["1", "2", "3"], context: { kind: "songs", id: null },
}).state;

test("moving to another entry writes only the index", () => {
  assert.deepEqual(queuePersistence({ state, positionMs: 0 }, {
    state: reduceQueue(state, { type: "next" }).state, positionMs: 0,
  }), { entries: false, index: true, position: false, metadata: false });
});

test("position progress writes only the position", () => {
  assert.deepEqual(queuePersistence({ state, positionMs: 0 }, { state, positionMs: 1234 }),
    { entries: false, index: false, position: true, metadata: false });
});

test("a new queue writes every part", () => {
  assert.deepEqual(queuePersistence(null, { state, positionMs: 0 }),
    { entries: true, index: true, position: true, metadata: true });
});

test("an unchanged queue writes nothing, even with a new state wrapper", () => {
  assert.deepEqual(queuePersistence({ state, positionMs: 500 }, { state: { ...state }, positionMs: 500 }),
    { entries: false, index: false, position: false, metadata: false });
});

for (const [name, command] of [
  ["entry addition", { type: "addToQueue", trackIds: ["4"] }],
  ["shuffle", { type: "setShuffle", on: true }],
  ["reorder", { type: "move", key: state.entries[2]!.key, after: state.entries[0]!.key, before: state.entries[1]!.key }],
] as const) {
  test(`${name} writes the changed entries`, () => {
    const next = reduceQueue(state, command).state;
    assert.equal(queuePersistence({ state, positionMs: 0 }, { state: next, positionMs: 0 }).entries, true);
  });
}

test("repeat changes save metadata without writing entries", () => {
  assert.deepEqual(queuePersistence({ state, positionMs: 0 }, {
    state: reduceQueue(state, { type: "setRepeat", mode: "all" }).state, positionMs: 0,
  }), { entries: false, index: false, position: false, metadata: true });
});

test("a changed entries reference is written even when its values match", () => {
  assert.equal(queuePersistence({ state, positionMs: 0 }, {
    state: { ...state, entries: [...state.entries] }, positionMs: 0,
  }).entries, true);
});
