import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatDuration, formatRemaining } from "./index.ts";

describe("formatDuration", () => {
  test("formats minutes and zero-padded seconds below an hour", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(7_000), "0:07");
    assert.equal(formatDuration(187_000), "3:07");
    assert.equal(formatDuration(59 * 60_000 + 59_000), "59:59");
  });

  test("adds hours and pads minutes from an hour up", () => {
    assert.equal(formatDuration(3_600_000), "1:00:00");
    assert.equal(formatDuration(3_723_000), "1:02:03");
    assert.equal(formatDuration(36_000_000), "10:00:00");
  });

  test("truncates partial seconds instead of rounding up", () => {
    assert.equal(formatDuration(59_999), "0:59");
  });

  test("treats negative and non-finite input as zero", () => {
    assert.equal(formatDuration(-5_000), "0:00");
    assert.equal(formatDuration(Number.NaN), "0:00");
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), "0:00");
  });
});

describe("formatRemaining", () => {
  test("shows the time left with a leading minus", () => {
    assert.equal(formatRemaining(0, 187_000), "-3:07");
    assert.equal(formatRemaining(60_500, 187_000), "-2:07");
  });

  test("elapsed and remaining always add up to the formatted duration", () => {
    const toSeconds = (label: string): number =>
      label
        .replace("-", "")
        .split(":")
        .reduce((total, part) => total * 60 + Number(part), 0);
    const duration = 187_400;
    for (const position of [0, 999, 1_000, 61_700, 186_999, 187_400]) {
      const elapsed = toSeconds(formatDuration(position));
      const remaining = toSeconds(formatRemaining(position, duration));
      assert.equal(elapsed + remaining, toSeconds(formatDuration(duration)), `at ${position}ms`);
    }
  });

  test("never goes below zero when the position overshoots", () => {
    assert.equal(formatRemaining(200_000, 187_000), "-0:00");
  });
});
