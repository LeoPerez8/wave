import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { underlineMotion, wavePath } from "./index.ts";

describe("wavePath", () => {
  test("draws the wave across the width plus one more wavelength, so sliding it one wavelength loops seamlessly", () => {
    // Centre line at y = amplitude; crests touch y = 0 and troughs y = 2 × amplitude.
    assert.equal(
      wavePath({ width: 8, wavelength: 8, amplitude: 2 }),
      "M0 2Q2 -2 4 2T8 2T12 2T16 2",
    );
  });

  test("a width between half-waves rounds up to the next one, never leaving a gap", () => {
    assert.equal(
      wavePath({ width: 5, wavelength: 8, amplitude: 1.5 }),
      "M0 1.5Q2 -1.5 4 1.5T8 1.5T12 1.5T16 1.5",
    );
  });

  test("a title not yet measured gets a single wavelength", () => {
    assert.equal(wavePath({ width: 0, wavelength: 6, amplitude: 1 }), "M0 1Q1.5 -1 3 1T6 1");
  });
});

describe("underlineMotion", () => {
  test("the underline wriggles while the song is playing", () => {
    assert.equal(underlineMotion({ isPlaying: true, reduceMotion: false }), "wriggle");
  });

  test("paused, it lies still", () => {
    assert.equal(underlineMotion({ isPlaying: false, reduceMotion: false }), "still");
  });

  test("the system's reduce-motion setting keeps it still while playing", () => {
    assert.equal(underlineMotion({ isPlaying: true, reduceMotion: true }), "still");
  });

  test("a legacy zero tap duration cannot stop the playing wave", () => {
    const legacyInput = { isPlaying: true, reduceMotion: false, tapAnimationMs: 0 };
    assert.equal(underlineMotion(legacyInput), "wriggle");
  });
});
