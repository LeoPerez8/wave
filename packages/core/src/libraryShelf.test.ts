import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LIBRARY_SHELF_CHOICES, parseLibraryShelf, storedLibraryShelf } from "./index.ts";

describe("Library shelf", () => {
  test("a fresh install (nothing stored) shows Recently added under the Library", () => {
    assert.equal(parseLibraryShelf(null), "recently-added");
  });

  test("the card offers the catalogue's shelves by their Home titles, then None", () => {
    assert.deepEqual(LIBRARY_SHELF_CHOICES, [
      { shelf: "discover", label: "Discover" },
      { shelf: "recently-added", label: "Recently added" },
      { shelf: "recently-played", label: "Recently played" },
      { shelf: "most-played-albums", label: "Most played albums" },
      { shelf: "most-played-artists", label: "Most played artists" },
      { shelf: "favorites", label: "Favorites" },
      { shelf: "none", label: "None" },
    ]);
  });

  test("every choice, None included, reads back as itself once stored", () => {
    for (const { shelf } of LIBRARY_SHELF_CHOICES) {
      assert.equal(parseLibraryShelf(storedLibraryShelf(shelf)), shelf);
    }
  });

  test("Artist mixes, or Discover mixes before it, picked before Discover held them, reads as Discover", () => {
    assert.equal(parseLibraryShelf("artist-mixes"), "discover");
    assert.equal(parseLibraryShelf("discover-mixes"), "discover");
  });

  test("anything else stored (junk, a section that isn't a shelf, one this Wave doesn't know) is Recently added", () => {
    assert.equal(parseLibraryShelf(""), "recently-added");
    assert.equal(parseLibraryShelf("stats"), "recently-added");
    assert.equal(parseLibraryShelf("most-played"), "recently-added");
    assert.equal(parseLibraryShelf("listening-overview"), "recently-added");
    assert.equal(parseLibraryShelf("NONE"), "recently-added");
  });

  test("Recently added, the default, is stored as nothing; None is stored", () => {
    assert.equal(storedLibraryShelf("recently-added"), null);
    assert.equal(storedLibraryShelf("none"), "none");
    assert.equal(storedLibraryShelf("favorites"), "favorites");
  });
});
