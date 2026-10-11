import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { favoriteStar, starWriteSettled, starWriteStarted, type FavoriteStar } from "./index.ts";

/** Starts a write per value in `writes`, in order. */
const toggle = (star: FavoriteStar, ...writes: boolean[]): FavoriteStar =>
  writes.reduce(starWriteStarted, star);

describe("favorite stars", () => {
  test("a star flips at once, before its write is saved", () => {
    assert.equal(toggle(favoriteStar(false), true).shown, true);
  });

  test("a failed write puts the star back as the library holds it", () => {
    const star = starWriteSettled(toggle(favoriteStar(false), true), null);
    assert.equal(star.shown, false);
    assert.equal(star.pending, 0);
  });

  test("toggles that overlap and all fail leave the star as the library holds it", () => {
    let star = toggle(favoriteStar(false), true, false);
    star = starWriteSettled(star, null);
    star = starWriteSettled(star, null);
    assert.equal(star.shown, false);

    let starred = toggle(favoriteStar(true), false, true, false);
    for (let i = 0; i < 3; i += 1) starred = starWriteSettled(starred, null);
    assert.equal(starred.shown, true);
  });

  test("when a later write fails, the star shows the last write that was saved", () => {
    let star = toggle(favoriteStar(false), true, false);
    star = starWriteSettled(star, true);
    assert.equal(star.shown, false, "the later toggle still shows while it's being saved");
    star = starWriteSettled(star, null);
    assert.equal(star.shown, true);
  });

  test("an earlier write failing doesn't undo a later toggle still being saved", () => {
    let star = toggle(favoriteStar(false), true, false, true);
    star = starWriteSettled(star, null);
    assert.equal(star.shown, true);
    star = starWriteSettled(star, false);
    star = starWriteSettled(star, true);
    assert.deepEqual(star, favoriteStar(true));
  });
});
