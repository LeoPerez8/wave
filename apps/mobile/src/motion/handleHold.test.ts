import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { handleHold, handleSwipeSlop } from "./handleHold.ts";

const src = join(import.meta.dirname, "..");

test("a handle lifts after a fixed 150 ms hold", () => {
  assert.equal(handleHold.activateAfterLongPress, 150);
});

test("no distance activates a handle: a pan with a reachable minDistance lifts on a swipe", () => {
  // Gesture Handler's Android pan checks minDist whatever the long press, so a
  // minDistance of 0 lifts on the first move, and the default (the touch slop)
  // lifts a swipe that lands exactly on the slop, where the pan doesn't fail yet.
  assert.ok(handleHold.minDistance > 100_000);
});

for (const file of [
  "catalog/rowDrag.ts",
  "components/RowReorder.tsx",
  "library/listDrag.ts",
  "settings/downloadsDrag.ts",
]) {
  test(`${file}: its handle's pan waits for the hold`, () => {
    const source = readFileSync(join(src, file), "utf8");
    const pans = source.split("usePanGesture(").slice(1);
    assert.equal(pans.length, 1, "one pan in the file");
    // Spelled out: the worklets Babel plugin fails the JS bundle on a spread in a gesture hook's object.
    assert.match(pans[0]!, /^[^}]*activateAfterLongPress: handleHold\.activateAfterLongPress,/);
    assert.match(pans[0]!, /^[^}]*minDistance: handleHold\.minDistance,/);
    assert.doesNotMatch(pans[0]!, /^[^}]*\.\.\./);
    assert.doesNotMatch(source, /minDistance: [^h]/);
  });
}

/** Where Gesture Handler lets a pan begin along a view [width] wide: `right += slop.right`. */
const swipeBeginsAt = (x: number, width: number, slop: { readonly right: number }): boolean =>
  x >= 0 && x <= width + slop.right;

test("a row's swipe can't begin on its handle, and begins anywhere else on the row", () => {
  const slop = handleSwipeSlop(48);
  assert.equal(swipeBeginsAt(0, 360, slop), true);
  assert.equal(swipeBeginsAt(311, 360, slop), true);
  assert.equal(swipeBeginsAt(313, 360, slop), false);
  assert.equal(swipeBeginsAt(359, 360, slop), false);
});

test("a row with no handle showing swipes from its whole width", () => {
  assert.equal(swipeBeginsAt(359, 360, handleSwipeSlop(0)), true);
});

test("a playlist's grip keeps the row's swipe off it only while it shows", () => {
  const swipeable = readFileSync(join(src, "catalog/SwipeableRow.tsx"), "utf8");
  // Always sent: left out of an update, a hit slop keeps its previous value on the native side.
  assert.match(swipeable, /usePanGesture\(\{[^}]*hitSlop: handleSwipeSlop\(handleWidth\),/);
  const row = readFileSync(join(src, "songs/SongRow.tsx"), "utf8");
  assert.match(row, /<SwipeableRow swipe=\{swipe\} handleWidth=\{props\.handleWidth\}>/);
  const playlist = readFileSync(join(src, "library/PlaylistItems.tsx"), "utf8");
  assert.match(playlist, /handleWidth: grip \? GRIP_WIDTH : 0/);
});
