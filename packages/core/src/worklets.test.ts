import assert from "node:assert/strict";
import { test } from "node:test";

import {
  elapsedWavePath,
  formatDuration,
  formatRemaining,
  framingView,
  mixPull,
  panFraming,
  pinchFraming,
  reorderGridShift,
  reorderGridTarget,
  reorderScrollSpeed,
  reorderShift,
  reorderTarget,
  rowSwipeArmed,
  scrubPosition,
} from "./index.ts";

// The app calls these on the UI thread, inside Reanimated worklets: the
// scrubber while a finger drags it, the crop screen while fingers frame a
// photo, and Up Next or the Playlists list while a
// row or tile is dragged. The worklets Babel plugin copies a function to the
// UI thread only when its body starts with the "worklet" directive; calling
// any other function there throws. Node ignores the directive, so these tests
// are the only check short of running the app.
const onUiThread = {
  elapsedWavePath,
  formatDuration,
  formatRemaining,
  framingView,
  mixPull,
  panFraming,
  pinchFraming,
  reorderGridShift,
  reorderGridTarget,
  reorderScrollSpeed,
  reorderShift,
  reorderTarget,
  rowSwipeArmed,
  scrubPosition,
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
