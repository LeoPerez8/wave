import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readNormalizeVolume, songGain, writeNormalizeVolume } from "./index.ts";

describe("readNormalizeVolume", () => {
  test("on when nothing is stored", () => {
    assert.equal(readNormalizeVolume(null), true);
  });

  test("off once the owner turned it off, and on again after", () => {
    assert.equal(readNormalizeVolume(writeNormalizeVolume(false)), false);
    assert.equal(readNormalizeVolume(writeNormalizeVolume(true)), true);
  });

  test("anything else stored reads as on", () => {
    assert.equal(readNormalizeVolume("maybe"), true);
  });
});

describe("songGain", () => {
  test("a streamed song louder than YouTube's reference is turned down by YouTube's value", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: 6.23 }), {
      gainDb: -6.23,
      source: "youtube",
    });
  });

  test("a streamed song quieter than YouTube's reference is never turned up, as YouTube gives no peak", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: -3.5 }), { gainDb: 0, source: "youtube" });
  });

  test("a streamed song right at YouTube's reference plays as it is", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: 0 }), { gainDb: 0, source: "youtube" });
  });

  test("a song Wave knows nothing about plays at the typical gain's starting value, -5 dB", () => {
    assert.deepEqual(songGain(true, {}), { gainDb: -5, source: "typical" });
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: null }), {
      gainDb: -5,
      source: "typical",
    });
  });

  test("a value YouTube didn't really give counts as nothing known", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: Number.NaN }), {
      gainDb: -5,
      source: "typical",
    });
  });

  test("with the switch off every song plays as it is", () => {
    assert.deepEqual(songGain(false, { youtubeLoudnessDb: 6.23 }), { gainDb: 0, source: "off" });
    assert.deepEqual(songGain(false, {}), { gainDb: 0, source: "off" });
  });
});
