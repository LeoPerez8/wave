import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_QUEUE,
  queueContinuation,
  readContinueQueue,
  reduceQueue,
  writeContinueQueue,
} from "./index.ts";

test("continuing a queue is on when nothing is stored, as on a fresh install or after an update", () => {
  assert.equal(readContinueQueue(null), true);
});

test("the owner's choice survives being stored, and on is stored as the default", () => {
  assert.equal(readContinueQueue(writeContinueQueue(false)), false);
  assert.equal(readContinueQueue(writeContinueQueue(true)), true);
  assert.equal(writeContinueQueue(true), null);
});

test("a value this Wave doesn't know keeps the queue continuing", () => {
  assert.equal(readContinueQueue("later"), true);
});

test("turned off, a queue at its last song stops there; on again, it continues", () => {
  const last = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1"],
    context: { kind: "album", id: "7" },
  }).state;
  const off = readContinueQueue(writeContinueQueue(false));
  assert.equal(queueContinuation(last, { enabled: off }), null);
  const on = readContinueQueue(writeContinueQueue(true));
  assert.deepEqual(queueContinuation(last, { enabled: on }), { kind: "album", id: "7" });
});
