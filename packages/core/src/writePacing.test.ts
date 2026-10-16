import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pendingWriteDelay } from "./index.ts";

describe("when a setting's pending change is written", () => {
  test("a single change is written delayMs after it", () => {
    assert.equal(pendingWriteDelay({ firstChangeAt: 0, now: 0 }, { delayMs: 1000 }), 1000);
  });

  test("without a cap, each change puts the write off again (a dragged slider)", () => {
    assert.equal(pendingWriteDelay({ firstChangeAt: 0, now: 5000 }, { delayMs: 1000 }), 1000);
  });

  test("with a cap, a steady stream of changes is still written maxDelayMs after its first", () => {
    const pacing = { delayMs: 1000, maxDelayMs: 2000 };
    assert.equal(pendingWriteDelay({ firstChangeAt: 0, now: 600 }, pacing), 1000);
    assert.equal(pendingWriteDelay({ firstChangeAt: 0, now: 1500 }, pacing), 500);
    assert.equal(pendingWriteDelay({ firstChangeAt: 0, now: 2400 }, pacing), 0);
  });
});
