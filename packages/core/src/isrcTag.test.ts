import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { djAudioFeaturesByIsrc, isrcFromTag } from "./index.ts";

describe("ReccoBeats rows by ISRC", () => {
  test("each ISRC gets the lower median of its valid rows; invalid rows count for nothing", () => {
    const found = djAudioFeaturesByIsrc([
      { isrc: "usrc17607839", energy: 0.2, valence: 0.3, acousticness: 0.4, mode: 0 },
      { isrc: "USRC17607839", energy: 0.8, valence: 0.7, acousticness: 0.6, mode: 1 },
      { isrc: "USRC17607839", energy: 1.5, valence: 0.7, acousticness: 0.6, mode: 1 },
      { isrc: "GBAYE0601498", energy: 0.5, valence: 0.5, acousticness: 0.5, mode: 2 },
      { energy: 0.5, valence: 0.5, acousticness: 0.5, mode: 1 },
      "not a row",
    ]);
    assert.deepEqual(
      found,
      new Map([["USRC17607839", { energy: 0.2, valence: 0.3, acousticness: 0.4, mode: 0 }]]),
    );
  });
});

describe("a file's ISRC tag", () => {
  test("reads a plain code in upper case", () => {
    assert.equal(isrcFromTag("usrc17607839"), "USRC17607839");
  });

  test("reads a code written with hyphens or spaces", () => {
    assert.equal(isrcFromTag(" US-RC1-76-07839 "), "USRC17607839");
    assert.equal(isrcFromTag("US RC1 76 07839"), "USRC17607839");
  });

  test("takes the first valid code of a tag holding several", () => {
    assert.equal(isrcFromTag("not a code; GBAYE0601498/USRC17607839"), "GBAYE0601498");
  });

  test("is null without a valid code", () => {
    assert.equal(isrcFromTag(null), null);
    assert.equal(isrcFromTag(""), null);
    assert.equal(isrcFromTag("USRC1760783"), null);
    assert.equal(isrcFromTag("12RC17607839"), null);
  });
});
