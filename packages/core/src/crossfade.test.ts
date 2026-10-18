import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CROSSFADE,
  crossfadeDuration,
  crossfadePrefetchAt,
  lateCrossfadeOverlap,
  readCrossfade,
  snapCrossfade,
} from "./index.ts";

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

describe("crossfadePrefetchAt", () => {
  test("the next song is fetched well before the overlap: 3-min song, 10 s overlap, 2:17 in", () => {
    // 180 s − 10 s overlap − 3 s pre-roll − 30 s ahead.
    assert.equal(crossfadePrefetchAt(10_000, 180_000), 137_000);
  });

  test("a song too short for that fetches the next one from its start", () => {
    assert.equal(crossfadePrefetchAt(10_000, 40_000), 0);
    // A 6 s song overlaps for 3 s at most, so it fetches from the start too.
    assert.equal(crossfadePrefetchAt(10_000, 6000), 0);
  });

  test("a longer overlap fetches earlier: 80 s song, 15 s overlap", () => {
    assert.equal(crossfadePrefetchAt(15_000, 80_000), 32_000);
  });

  test("nothing to fetch ahead with crossfade off or the length unknown", () => {
    assert.equal(crossfadePrefetchAt(0, 180_000), null);
    assert.equal(crossfadePrefetchAt(10_000, null), null);
  });
});

describe("lateCrossfadeOverlap", () => {
  test("a next song buffered 4 s late into a 10 s overlap overlaps for the 6 s left", () => {
    assert.equal(lateCrossfadeOverlap(10_000, 6000), 6000);
  });

  test("one ready on time overlaps for the whole setting", () => {
    assert.equal(lateCrossfadeOverlap(10_000, 10_000), 10_000);
    assert.equal(lateCrossfadeOverlap(10_000, 10_040), 10_000);
  });

  test("with under a second left, or the song over, the move is gapless", () => {
    assert.equal(lateCrossfadeOverlap(10_000, 1000), 1000);
    assert.equal(lateCrossfadeOverlap(10_000, 999), 0);
    assert.equal(lateCrossfadeOverlap(10_000, 0), 0);
    assert.equal(lateCrossfadeOverlap(10_000, -500), 0);
  });
});
