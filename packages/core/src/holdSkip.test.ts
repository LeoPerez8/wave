import assert from "node:assert/strict";
import { test } from "node:test";

import { HOLD_SKIP_STEP_MS, holdSkipSeconds, holdSkipStep } from "./index.ts";

test("a held Next jumps 5 seconds forward and adds them to the total", () => {
  assert.equal(HOLD_SKIP_STEP_MS, 5_000);
  assert.deepEqual(holdSkipStep({ positionMs: 30_000, durationMs: 200_000 }, "forward", 0), {
    positionMs: 35_000,
    movedMs: 5_000,
    last: false,
  });
  assert.deepEqual(holdSkipStep({ positionMs: 35_200, durationMs: 200_000 }, "forward", 5_000), {
    positionMs: 40_200,
    movedMs: 10_000,
    last: false,
  });
});

test("a held Previous jumps 5 seconds back, the total counting down", () => {
  assert.deepEqual(holdSkipStep({ positionMs: 30_000, durationMs: 200_000 }, "back", -5_000), {
    positionMs: 25_000,
    movedMs: -10_000,
    last: false,
  });
});

test("back stops at the start and never goes to the previous song", () => {
  assert.deepEqual(holdSkipStep({ positionMs: 3_000, durationMs: 200_000 }, "back", -5_000), {
    positionMs: 0,
    movedMs: -8_000,
    last: true,
  });
  assert.deepEqual(holdSkipStep({ positionMs: 0, durationMs: 200_000 }, "back", 0), {
    positionMs: 0,
    movedMs: 0,
    last: true,
  });
});

test("forward past the end lands on the end, so the song ends as if it played out", () => {
  assert.deepEqual(holdSkipStep({ positionMs: 197_000, durationMs: 200_000 }, "forward", 10_000), {
    positionMs: 200_000,
    movedMs: 13_000,
    last: true,
  });
  assert.deepEqual(holdSkipStep({ positionMs: 195_000, durationMs: 200_000 }, "forward", 0), {
    positionMs: 200_000,
    movedMs: 5_000,
    last: true,
  });
});

test("forward goes on while the song's length is unknown", () => {
  assert.deepEqual(holdSkipStep({ positionMs: 10_000, durationMs: null }, "forward", 0), {
    positionMs: 15_000,
    movedMs: 5_000,
    last: false,
  });
});

test("the label counts whole seconds moved, without the sign", () => {
  assert.equal(holdSkipSeconds(5_000), 5);
  assert.equal(holdSkipSeconds(-10_000), 10);
  assert.equal(holdSkipSeconds(13_400), 13);
  assert.equal(holdSkipSeconds(0), 0);
});
