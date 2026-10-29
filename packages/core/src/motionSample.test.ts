import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  bounceDemoSwipe,
  DEFAULT_SWIPE_SETTINGS,
  rowSwipeArmed,
  sampleSwipeActions,
} from "./index.ts";

describe("the sample row's swipes", () => {
  test("with Wave's defaults it adds to the queue to the right and deletes to the left", () => {
    assert.deepEqual(sampleSwipeActions(DEFAULT_SWIPE_SETTINGS), {
      right: "addToQueue",
      left: "delete",
    });
  });

  test("every choice shows, the star as Favorite and Remove as Delete", () => {
    assert.deepEqual(sampleSwipeActions({ enabled: true, right: "favorite", left: "remove" }), {
      right: "favorite",
      left: "delete",
    });
    assert.deepEqual(sampleSwipeActions({ enabled: true, right: "download", left: "goToAlbum" }), {
      right: "download",
      left: "goToAlbum",
    });
    assert.deepEqual(sampleSwipeActions({ enabled: true, right: "fixSong", left: "goToArtist" }), {
      right: "fixSong",
      left: "goToArtist",
    });
  });

  test("with swipes off it uncovers nothing on either side", () => {
    assert.deepEqual(sampleSwipeActions({ ...DEFAULT_SWIPE_SETTINGS, enabled: false }), {
      right: null,
      left: null,
    });
  });
});

describe("the sample row's demo swipe", () => {
  test("goes a quarter of the row to the right, short of arming, then springs back", () => {
    const demo = bounceDemoSwipe({ width: 360, reduceMotion: false });
    assert.ok(demo !== null);
    assert.equal(demo.translationX, 90);
    assert.equal(rowSwipeArmed({ translationX: demo.translationX, width: 360 }), null);
    assert.ok(demo.outMs > 0);
  });

  test("doesn't play under reduce motion", () => {
    assert.equal(bounceDemoSwipe({ width: 360, reduceMotion: true }), null);
  });

  test("doesn't play before the row has a width", () => {
    assert.equal(bounceDemoSwipe({ width: 0, reduceMotion: false }), null);
  });
});
