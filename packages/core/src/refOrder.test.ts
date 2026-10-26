import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compareRefIds, compareTrackRefs, type TrackRef } from "./index.ts";

const sorted = <T>(items: readonly T[], compare: (a: T, b: T) => number): T[] =>
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
  [...items].sort(compare);

describe("compareRefIds", () => {
  const ids = ["MPREb_b", 12, "MPREb_a", 3, "Abc", 12];

  test("puts Library ids before online ones, the lowest first, then online ids in string order", () => {
    assert.deepEqual(sorted(ids, compareRefIds), [3, 12, 12, "Abc", "MPREb_a", "MPREb_b"]);
  });

  test("can put the latest added Library id first, online ids still in string order", () => {
    assert.deepEqual(
      sorted(ids, (a, b) => compareRefIds(a, b, "latest first")),
      [12, 12, 3, "Abc", "MPREb_a", "MPREb_b"],
    );
  });

  test("an id ties with itself", () => {
    assert.equal(compareRefIds(5, 5), 0);
    assert.equal(compareRefIds("x", "x", "latest first"), 0);
  });
});

const library = (id: number): TrackRef => ({ kind: "library", id });
const streamed = (videoId: string): TrackRef => ({ kind: "yt", videoId });

describe("compareTrackRefs", () => {
  const refs = [streamed("y"), library(1), streamed("x"), library(2)];

  test("orders songs as compareRefIds orders their Library ids and video ids", () => {
    assert.deepEqual(sorted(refs, compareTrackRefs), [
      library(1),
      library(2),
      streamed("x"),
      streamed("y"),
    ]);
    assert.deepEqual(
      sorted(refs, (a, b) => compareTrackRefs(a, b, "latest first")),
      [library(2), library(1), streamed("x"), streamed("y")],
    );
  });

  test("a video id that looks like a number is still a streamed song's", () => {
    assert.deepEqual(sorted([streamed("1"), library(9)], compareTrackRefs), [
      library(9),
      streamed("1"),
    ]);
  });
});
