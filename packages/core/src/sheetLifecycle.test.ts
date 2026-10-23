import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stepNowPlayingSheet, type SheetPhase } from "./index.ts";

describe("stepNowPlayingSheet", () => {
  test("tapping the mini player shows the sheet and springs it up from below at once", () => {
    assert.deepEqual(stepNowPlayingSheet("hidden", { type: "tap" }), {
      phase: "opening",
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
      phase: "opening",
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
      phase: "opening",
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

test("a link navigates in its close step from every phase, never again on later sheet events", () => {
  for (const phase of ["hidden", "opening", "open", "drag", "closing"] as const) {
    const link = stepNowPlayingSheet(phase, { type: "linkClose" });
    assert.equal(link.navigateNow, true, phase);
    assert.equal(link.phase, phase === "hidden" ? "hidden" : "closing");
    assert.equal(link.spring, phase === "hidden" ? null : "closed");
    assert.equal(link.hidden, false, "hiding waits for the spring end");
    let current: SheetPhase = link.phase;
    for (const event of [
      { type: "close" },
      { type: "release", to: "closed" },
      { type: "closed" },
    ] as const) {
      const next = stepNowPlayingSheet(current, event);
      assert.notEqual(next.navigateNow, true);
      current = next.phase;
    }
  }
});

test("opening ends only on its own spring completion; a stale opening end cannot undo a link close", () => {
  const opening = stepNowPlayingSheet("hidden", { type: "tap" });
  assert.equal(opening.phase, "opening");
  assert.equal(stepNowPlayingSheet(opening.phase, { type: "opened" }).phase, "open");
  const link = stepNowPlayingSheet(opening.phase, { type: "linkClose" });
  assert.deepEqual(stepNowPlayingSheet(link.phase, { type: "opened" }), {
    phase: "closing",
    spring: null,
    hidden: false,
  });
});
