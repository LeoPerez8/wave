import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extrapolatePosition, scrubPosition } from "./index.ts";

describe("extrapolatePosition", () => {
  test("while playing, the position runs on from the last report", () => {
    const report = { positionMs: 30_000, durationMs: 200_000, at: 1_000, isPlaying: true };
    assert.equal(extrapolatePosition(report, 1_750), 30_750);
  });

  test("never runs past the end of the track while waiting for the next report", () => {
    const report = { positionMs: 199_500, durationMs: 200_000, at: 1_000, isPlaying: true };
    assert.equal(extrapolatePosition(report, 3_000), 200_000);
  });

  test("while paused, the position stays where it was reported", () => {
    const report = { positionMs: 30_000, durationMs: 200_000, at: 1_000, isPlaying: false };
    assert.equal(extrapolatePosition(report, 9_000), 30_000);
  });

  test("a report stamped a moment in the future doesn't pull the playhead back", () => {
    const report = { positionMs: 30_000, durationMs: 200_000, at: 1_200, isPlaying: true };
    assert.equal(extrapolatePosition(report, 1_000), 30_000);
  });
});

describe("scrubPosition", () => {
  test("a touch a quarter of the way along the bar seeks a quarter into the track", () => {
    assert.equal(scrubPosition({ x: 91, width: 364, durationMs: 200_000 }), 50_000);
  });

  test("a finger dragged past either end of the bar holds at the start or the end", () => {
    assert.equal(scrubPosition({ x: -40, width: 364, durationMs: 200_000 }), 0);
    assert.equal(scrubPosition({ x: 400, width: 364, durationMs: 200_000 }), 200_000);
  });

  test("a bar that hasn't been laid out yet seeks to the start", () => {
    assert.equal(scrubPosition({ x: 10, width: 0, durationMs: 200_000 }), 0);
  });
});
