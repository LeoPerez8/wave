import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PLAYLIST_LAYOUTS,
  parsePlaylistLayout,
  playlistLayoutRows,
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

  test("the list and large cards show one playlist per row", () => {
    assert.deepEqual(playlistLayoutRows(["a", "b", "c"], "list"), [["a"], ["b"], ["c"]]);
    assert.deepEqual(playlistLayoutRows(["a", "b", "c"], "large"), [["a"], ["b"], ["c"]]);
  });

  test("the grid pairs playlists in order, an odd one out alone on the last row", () => {
    assert.deepEqual(playlistLayoutRows(["a", "b", "c", "d", "e"], "grid"), [
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  test("no playlists make no rows", () => {
    assert.deepEqual(playlistLayoutRows([], "grid"), []);
  });
});
