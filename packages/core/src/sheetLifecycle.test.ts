import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stepNowPlayingSheet } from "./index.ts";

describe("stepNowPlayingSheet", () => {
  test("tapping the mini player shows the sheet and springs it up from below at once", () => {
    assert.deepEqual(stepNowPlayingSheet("hidden", { type: "tap" }), {
      phase: "open",
      spring: "rise",
      hidden: false,
    });
  });

  test("closing an open sheet springs it away and hides it once it is out of sight", () => {
    const closing = stepNowPlayingSheet("open", { type: "close" });
    assert.deepEqual(closing, { phase: "closing", spring: "closed", hidden: false });
    assert.deepEqual(stepNowPlayingSheet(closing.phase, { type: "closed" }), {
      phase: "hidden",
      spring: null,
      hidden: true,
    });
  });

  test("tapping the mini player while the sheet is still leaving brings it back from where it is", () => {
    assert.deepEqual(stepNowPlayingSheet("closing", { type: "tap" }), {
      phase: "open",
      spring: "open",
      hidden: false,
    });
  });

  test("a close that was overtaken by a reopen doesn't hide the sheet when its spring ends", () => {
    assert.deepEqual(stepNowPlayingSheet("open", { type: "closed" }), {
      phase: "open",
      spring: null,
      hidden: false,
    });
  });

  test("a swipe up on the mini player shows the sheet under the finger without a spring", () => {
    assert.deepEqual(stepNowPlayingSheet("hidden", { type: "dragBegin" }), {
      phase: "drag",
      spring: null,
      hidden: false,
    });
  });

  test("letting go of a swipe up springs the sheet to where it settles", () => {
    assert.deepEqual(stepNowPlayingSheet("drag", { type: "release", to: "open" }), {
      phase: "open",
      spring: "open",
      hidden: false,
    });
    assert.deepEqual(stepNowPlayingSheet("drag", { type: "release", to: "closed" }), {
      phase: "closing",
      spring: "closed",
      hidden: false,
    });
  });

  test("dragging an open sheet down and letting it go far enough dismisses it", () => {
    assert.deepEqual(stepNowPlayingSheet("open", { type: "release", to: "closed" }), {
      phase: "closing",
      spring: "closed",
      hidden: false,
    });
  });

  test("closing a sheet that is already out of sight does nothing", () => {
    assert.deepEqual(stepNowPlayingSheet("hidden", { type: "close" }), {
      phase: "hidden",
      spring: null,
      hidden: false,
    });
  });

  test("tapping while the sheet is already open does nothing", () => {
    assert.deepEqual(stepNowPlayingSheet("open", { type: "tap" }), {
      phase: "open",
      spring: null,
      hidden: false,
    });
  });
});
