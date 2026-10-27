import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE, reduceQueue } from "./queue.ts";
import { queuePersistence, queueWrite, savedQueueState } from "./queuePersistence.ts";

const state = reduceQueue(EMPTY_QUEUE, {
  type: "play",
  trackIds: ["1", "2", "3"],
  context: { kind: "songs", id: null },
}).state;

test("moving to another entry writes only the index", () => {
  assert.deepEqual(
    queuePersistence(
      { state, positionMs: 0 },
      {
        state: reduceQueue(state, { type: "next" }).state,
        positionMs: 0,
      },
    ),
    { entries: false, index: true, position: false, metadata: false },
  );
});

test("position progress writes only the position", () => {
  assert.deepEqual(queuePersistence({ state, positionMs: 0 }, { state, positionMs: 1234 }), {
    entries: false,
    index: false,
    position: true,
    metadata: false,
  });
});

test("a new queue writes every part", () => {
  assert.deepEqual(queuePersistence(null, { state, positionMs: 0 }), {
    entries: true,
    index: true,
    position: true,
    metadata: true,
  });
});

test("an unchanged queue writes nothing, even with a new state wrapper", () => {
  assert.deepEqual(
    queuePersistence({ state, positionMs: 500 }, { state: { ...state }, positionMs: 500 }),
    { entries: false, index: false, position: false, metadata: false },
  );
});

for (const [name, command] of [
  ["entry addition", { type: "addToQueue", trackIds: ["4"] }],
  ["shuffle", { type: "setShuffle", on: true }],
  [
    "reorder",
    {
      type: "move",
      key: state.entries[2]!.key,
      after: state.entries[0]!.key,
      before: state.entries[1]!.key,
    },
  ],
] as const) {
  test(`${name} writes the changed entries`, () => {
    const next = reduceQueue(state, command).state;
    assert.equal(
      queuePersistence({ state, positionMs: 0 }, { state: next, positionMs: 0 }).entries,
      true,
    );
  });
}

test("repeat changes save metadata without writing entries", () => {
  assert.deepEqual(
    queuePersistence(
      { state, positionMs: 0 },
      {
        state: reduceQueue(state, { type: "setRepeat", mode: "all" }).state,
        positionMs: 0,
      },
    ),
    { entries: false, index: false, position: false, metadata: true },
  );
});

test("a changed entries reference is written even when its values match", () => {
  assert.equal(
    queuePersistence(
      { state, positionMs: 0 },
      {
        state: { ...state, entries: [...state.entries] },
        positionMs: 0,
      },
    ).entries,
    true,
  );
});

test("a skip serialises nothing: its write never visits the entries", () => {
  const entries = new Proxy(state.entries, {
    get() {
      throw new Error("a skip visited entries");
    },
  });
  const previous = { state: { ...state, entries }, positionMs: 83000 };
  const next = { state: { ...state, entries, index: 1 }, positionMs: 0 };
  assert.deepEqual(queueWrite(previous, next), { index: 1, positionMs: 0 });
});

test("an unchanged queue has nothing to write", () => {
  assert.deepEqual(
    queueWrite({ state, positionMs: 500 }, { state: { ...state }, positionMs: 500.2 }),
    {},
  );
});

test("a new queue writes the whole state with its parts", () => {
  const write = queueWrite(null, { state, positionMs: 1234.6 });
  assert.deepEqual(JSON.parse(write.queue!), state);
  assert.deepEqual(JSON.parse(write.metadata!), {
    context: state.context,
    shuffle: state.shuffle,
    repeat: state.repeat,
    nextKey: state.nextKey,
  });
  assert.equal(write.index, state.index);
  assert.equal(write.positionMs, 1235);
});

test("the saved parts read back as the latest queue", () => {
  const first = queueWrite(null, { state, positionMs: 0 });
  const skipped = reduceQueue(state, { type: "next" }).state;
  const repeated = reduceQueue(skipped, { type: "setRepeat", mode: "one" }).state;
  const later = queueWrite({ state: skipped, positionMs: 0 }, { state: repeated, positionMs: 0 });
  assert.equal(later.queue, undefined);
  assert.deepEqual(
    savedQueueState({ queue: first.queue!, metadata: later.metadata!, index: 1 }),
    repeated,
  );
});

test("a queue saved whole by an earlier Wave reads back as it was", () => {
  assert.deepEqual(
    savedQueueState({ queue: JSON.stringify(state), metadata: null, index: null }),
    state,
  );
});

test("an index past the saved entries falls back to the entries' own index", () => {
  assert.deepEqual(
    savedQueueState({ queue: JSON.stringify(state), metadata: null, index: 9 }),
    state,
  );
});

test("unreadable saved parts read as no queue", () => {
  assert.equal(savedQueueState({ queue: "{", metadata: null, index: null }), null);
  assert.equal(savedQueueState({ queue: "[]", metadata: null, index: 0 }), null);
});
