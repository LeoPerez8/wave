import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentLyricIndex,
  extrapolatePosition,
  elapsedWavePath,
  formatDuration,
  formatRemaining,
  framingView,
  mixPull,
  panFraming,
  pinchFraming,
  playerTouchAllowed,
  reorderGridShift,
  reorderGridTarget,
  reorderScrollSpeed,
  reorderShift,
  reorderTarget,
  rowSwipeArmed,
  scrubPosition,
  sleepTimerLabelSeconds,
  sleepTimerRemaining,
} from "./index.ts";

// The app calls these on the UI thread, inside Reanimated worklets: the
// scrubber while a finger drags it, the crop screen while fingers frame a
// photo, the mini player's pans while a long-press menu may own the touch,
// and Up Next or the Playlists list while a
// row or tile is dragged. The worklets Babel plugin copies a function to the
// UI thread only when its body starts with the "worklet" directive; calling
// any other function there throws. Node ignores the directive, so these tests
// are the only check short of running the app.
const onUiThread = {
  currentLyricIndex,
  extrapolatePosition,
  elapsedWavePath,
  formatDuration,
  formatRemaining,
  framingView,
  mixPull,
  panFraming,
  pinchFraming,
  playerTouchAllowed,
  reorderGridShift,
  reorderGridTarget,
  reorderScrollSpeed,
  reorderShift,
  reorderTarget,
  rowSwipeArmed,
  scrubPosition,
  sleepTimerLabelSeconds,
  sleepTimerRemaining,
};

const startsWithWorkletDirective = (fn: (...args: never[]) => unknown): boolean =>
  /(=>|\))\s*\{\s*["']worklet["'];/.test(String(fn));

for (const [name, fn] of Object.entries(onUiThread)) {
  test(`${name} can run on the UI thread`, () => {
    assert.ok(startsWithWorkletDirective(fn), `${name} must start with "worklet"`);
  });
}

test("a function without the directive is caught", () => {
  assert.equal(
    startsWithWorkletDirective((x: number) => x + 1),
    false,
  );
});
