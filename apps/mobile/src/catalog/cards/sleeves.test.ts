import assert from "node:assert/strict";
import { test } from "node:test";
import { coverTop } from "./sleeves.ts";

test("a tile's sleeves take two 3dp bars, each with a 2dp gap, above its cover", () => {
  assert.equal(coverTop({ sleeves: true }), 10);
});

test("a plain cover (the Playlists page) starts at the tile's top", () => {
  assert.equal(coverTop({ sleeves: false }), 0);
});

test("a row's sleeves are smaller: two 2dp bars, each with a 1dp gap", () => {
  assert.equal(coverTop({ sleeves: true, small: true }), 6);
  assert.equal(coverTop({ sleeves: false, small: true }), 0);
});
