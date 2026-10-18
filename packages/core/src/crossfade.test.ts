import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CROSSFADE, crossfadeDuration, readCrossfade, snapCrossfade } from "./index.ts";

describe("crossfadeDuration", () => {
  test("songs ending on their own overlap the next for the chosen time, half seconds included", () => {
    assert.equal(crossfadeDuration(4.5), 4500);
    assert.equal(crossfadeDuration(10), 10_000);
  });

  test("off by default: zero keeps playback gapless", () => {
    assert.equal(CROSSFADE.default, 0);
    assert.equal(crossfadeDuration(0), 0);
  });

  test("a setting off the slider overlaps for the nearest one", () => {
    assert.equal(crossfadeDuration(2.7), 2500);
    assert.equal(crossfadeDuration(12.2), 12_000);
    assert.equal(crossfadeDuration(20), 15_000);
  });

  test("overlaps for up to 15 s", () => {
    assert.equal(crossfadeDuration(15), 15_000);
  });
});

describe("the Crossfade setting", () => {
  test("is read back as stored, and as off when nothing is", () => {
    assert.equal(readCrossfade("3.5"), 3.5);
    assert.equal(readCrossfade(null), 0);
    assert.equal(readCrossfade("soon"), 0);
  });

  test("keeps a stored or synced 15 s as is", () => {
    assert.equal(readCrossfade("15"), 15);
    assert.equal(readCrossfade("12.5"), 12.5);
  });

  test("stays within 0–15 s on half-second steps", () => {
    assert.equal(CROSSFADE.max, 15);
    assert.equal(CROSSFADE.step, 0.5);
    assert.equal(snapCrossfade(16), 15);
    assert.equal(snapCrossfade(14.8), 15);
    assert.equal(snapCrossfade(11), 11);
    assert.equal(snapCrossfade(-1), 0);
    assert.equal(snapCrossfade(2.7), 2.5);
    assert.equal(readCrossfade("7.8"), 8);
  });
});
