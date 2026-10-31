import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { handleHold } from "./handleHold.ts";

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
    assert.match(pans[0]!, /^[^}]*\.\.\.handleHold,/);
    assert.doesNotMatch(source, /minDistance/);
  });
}
