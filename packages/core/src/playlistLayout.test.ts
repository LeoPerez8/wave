import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PLAYLIST_LAYOUTS,
  parsePlaylistLayout,
  storedPlaylistLayout,
} from "./index.ts";

describe("playlist layout", () => {
  test("a fresh install (nothing stored) shows playlists as a list", () => {
    assert.equal(parsePlaylistLayout(null), "list");
  });

  test("every layout reads back as itself once stored", () => {
    for (const { layout } of PLAYLIST_LAYOUTS) {
      assert.equal(parsePlaylistLayout(storedPlaylistLayout(layout)), layout);
    }
  });

  test("anything else stored (junk, a layout this Wave doesn't know) falls back to the list", () => {
    assert.equal(parsePlaylistLayout(""), "list");
    assert.equal(parsePlaylistLayout("carousel"), "list");
    assert.equal(parsePlaylistLayout("GRID"), "list");
  });

  test("the list, the default, is stored as nothing", () => {
    assert.equal(storedPlaylistLayout("list"), null);
    assert.equal(storedPlaylistLayout("grid"), "grid");
    assert.equal(storedPlaylistLayout("large"), "large");
  });

  test("the card offers List, Grid and Large Cards, in that order", () => {
    assert.deepEqual(
      PLAYLIST_LAYOUTS.map(({ label }) => label),
      ["List", "Grid", "Large Cards"],
    );
  });
});
