import assert from "node:assert/strict";
import test from "node:test";
import { openingArtist, openedArtistCover } from "./openedArtist.ts";

test("the artist page opened from a tile knows the tile's cover", () => {
  openingArtist("UC_one", "https://img/one");
  assert.equal(openedArtistCover("UC_one"), "https://img/one");
});

test("another artist's page doesn't take the last tapped cover", () => {
  openingArtist("UC_one", "https://img/one");
  assert.equal(openedArtistCover("UC_two"), null);
  // Opened with no cover known, the page knows none.
  openingArtist("UC_two", undefined);
  assert.equal(openedArtistCover("UC_two"), null);
});
