import assert from "node:assert/strict";
import { test } from "node:test";

import { crossfadeDuration } from "./index.ts";

test("natural transitions overlap for the chosen duration, including half seconds", () => {
  assert.equal(crossfadeDuration(4.5, "natural", null), 4500);
});

test("zero stays gapless and manual changes never fade", () => {
  assert.equal(crossfadeDuration(0, "natural", null), 0);
  for (const reason of ["next", "previous", "select"] as const) {
    assert.equal(crossfadeDuration(10, reason, null), 0);
  }
});

test("end-of-song sleep suppresses overlap, whereas a deadline still allows it", () => {
  assert.equal(crossfadeDuration(6, "natural", { type: "endOfTrack" }), 0);
  assert.equal(crossfadeDuration(6, "natural", { type: "deadline", endsAt: 100_000 }), 6000);
});

test("stored values are constrained to the slider's range and half-second steps", () => {
  assert.equal(crossfadeDuration(11, "natural", null), 10_000);
  assert.equal(crossfadeDuration(-1, "natural", null), 0);
  assert.equal(crossfadeDuration(2.7, "natural", null), 2500);
  assert.equal(crossfadeDuration(Number.NaN, "natural", null), 0);
});
