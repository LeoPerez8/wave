import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bufferAheadMs, readStreamBuffer, STREAM_BUFFER_MINUTES, streamBufferMs } from "./index.ts";

describe("readStreamBuffer", () => {
  test("offers 1, 2, 5, 10, 15 and 30 minutes", () => {
    assert.deepEqual(STREAM_BUFFER_MINUTES, [1, 2, 5, 10, 15, 30]);
  });

  test("2 minutes when nothing is stored", () => {
    assert.equal(readStreamBuffer(null), 2);
  });

  test("a stored choice comes back", () => {
    assert.equal(readStreamBuffer("30"), 30);
    assert.equal(readStreamBuffer("1"), 1);
  });

  test("anything not offered falls back to 2 minutes", () => {
    assert.equal(readStreamBuffer("0.5"), 2);
    assert.equal(readStreamBuffer("7"), 2);
    assert.equal(readStreamBuffer("lots"), 2);
  });
});

describe("bufferAheadMs", () => {
  test("while a streamed song loads, the player keeps the chosen minutes ahead", () => {
    assert.equal(bufferAheadMs(streamBufferMs(2), true), 120_000);
    assert.equal(bufferAheadMs(streamBufferMs(30), true), 1_800_000);
  });

  test("a library file keeps the player's own 50 s, whatever the choice", () => {
    assert.equal(bufferAheadMs(streamBufferMs(30), false), 50_000);
    assert.equal(bufferAheadMs(streamBufferMs(1), false), 50_000);
  });

  test("never less than the player's own 50 s for a streamed song either", () => {
    assert.equal(bufferAheadMs(10_000, true), 50_000);
  });
});
