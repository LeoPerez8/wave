import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE, reduceQueue } from "@wave/core";
import { queueWrite } from "./queuePersistence.ts";

const state = reduceQueue(EMPTY_QUEUE, {
  type: "play", trackIds: ["1", "2", "3"], context: { kind: "songs", id: null },
}).state;

test("a skip never visits entries while preparing its persistence write", () => {
  const entries = new Proxy(state.entries, {
    get() { throw new Error("a skip visited entries"); },
  });
  const previous = { state: { ...state, entries }, positionMs: 83000 };
  const next = { state: { ...state, entries, index: 1 }, positionMs: 0 };
  assert.deepEqual(queueWrite(previous, next), { index: 1, positionMs: 0 });
});
