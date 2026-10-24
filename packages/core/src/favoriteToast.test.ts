import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { favoriteToast } from "./index.ts";

describe("favoriteToast", () => {
  test("a swipe, menu or selection confirms favoriting one song", () => {
    for (const source of ["swipe", "menu", "selection"] as const)
      assert.equal(favoriteToast(source, true, 1), "Added to Favorites");
  });

  test("Now Playing, any Unfavorite and empty selections have no toast", () => {
    for (const source of ["swipe", "menu", "selection", "nowPlaying"] as const) {
      assert.equal(favoriteToast(source, false, 1), null);
      assert.equal(favoriteToast(source, false, 5), null);
      assert.equal(favoriteToast(source, true, 0), null);
    }
    assert.equal(favoriteToast("nowPlaying", true, 1), null);
  });

  test("a selection of several songs says how many were added", () => {
    assert.equal(favoriteToast("selection", true, 2), "Added 2 songs to Favorites");
    assert.equal(favoriteToast("selection", true, 12), "Added 12 songs to Favorites");
  });
});
