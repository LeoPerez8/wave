import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CROSSFADE, crossfadeDuration, readCrossfade, snapCrossfade } from "./index.ts";

describe("crossfadeDuration", () => {
  test("a song ending on its own overlaps the next for the chosen time, half seconds included", () => {
    assert.equal(crossfadeDuration(4.5, "natural", null), 4500);
    assert.equal(crossfadeDuration(10, "natural", null), 10_000);
  });

  test("off by default: zero keeps playback gapless", () => {
    assert.equal(CROSSFADE.default, 0);
    assert.equal(crossfadeDuration(0, "natural", null), 0);
  });

  test("skip, previous and picking a song switch at once", () => {
    for (const reason of ["next", "previous", "select"] as const) {
      assert.equal(crossfadeDuration(10, reason, null), 0);
    }
  });

  test("repeat one loops the song without fading into itself", () => {
    assert.equal(crossfadeDuration(6, "repeat", null), 0);
  });

  test("an end-of-song sleep timer stops after the song, with no fade into the next one", () => {
    assert.equal(crossfadeDuration(6, "natural", { type: "endOfTrack" }), 0);
  });

  test("a sleep timer set for a time still lets songs overlap until it runs out", () => {
    assert.equal(crossfadeDuration(6, "natural", { type: "deadline", endsAt: 100_000 }), 6000);
  });
});

describe("the Crossfade setting", () => {
  test("is read back as stored, and as off when nothing is", () => {
    assert.equal(readCrossfade("3.5"), 3.5);
    assert.equal(readCrossfade(null), 0);
    assert.equal(readCrossfade("soon"), 0);
  });

  test("stays within 0–10 s on half-second steps", () => {
    assert.equal(snapCrossfade(11), 10);
    assert.equal(snapCrossfade(-1), 0);
    assert.equal(snapCrossfade(2.7), 2.5);
    assert.equal(readCrossfade("7.8"), 8);
  });
});
