import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_DJ_SETTINGS,
  djArtistTile,
  djCanStart,
  djOpened,
  djReopened,
  djSeedTiles,
  readDjRemembered,
  storedDjRemembered,
  type DjSettings,
} from "./index.ts";

const tile = (name: string, libraryId: number | null = null) => {
  const made = djArtistTile(name, libraryId);
  assert.ok(made);
  return made;
};

const chosen: DjSettings = {
  variety: "high",
  discovery: "familiar",
  popularity: "trending",
  newReleases: true,
};

describe("what DJ remembers on the phone", () => {
  test("the last selection and Adjust choices read back as they were kept", () => {
    const stored = storedDjRemembered({
      tiles: [tile("Burial"), tile("Four Tet")],
      settings: chosen,
    });
    assert.deepEqual(readDjRemembered(stored), {
      tiles: [tile("Burial"), tile("Four Tet")],
      settings: chosen,
    });
  });

  test("nothing stored means no selection and the default Adjust choices", () => {
    assert.deepEqual(readDjRemembered(null), { tiles: [], settings: DEFAULT_DJ_SETTINGS });
    assert.equal(storedDjRemembered({ tiles: [], settings: DEFAULT_DJ_SETTINGS }), null);
  });

  test("a malformed stored value reads as nothing stored", () => {
    const nothing = { tiles: [], settings: DEFAULT_DJ_SETTINGS };
    for (const stored of ["", "{", "null", "[]", "7", '"dj"', '{"tiles":7,"settings":[]}'])
      assert.deepEqual(readDjRemembered(stored), nothing, stored);
  });

  test("a stored tile that can't be drawn is left out, and the rest stand", () => {
    const stored = JSON.stringify({
      version: 1,
      tiles: [
        null,
        "Burial",
        { kind: "artist" },
        { kind: "artist", name: 7 },
        { kind: "artist", name: "Burial" },
        // A kind a newer Wave keeps.
        { kind: "genre", name: "Dubstep" },
        { name: "Four Tet" },
        { kind: "artist", name: "Various Artists" },
        { kind: "artist", name: "burial" },
        { kind: "artist", name: "Four Tet" },
      ],
      settings: { variety: "low", discovery: "nowhere" },
    });
    assert.deepEqual(readDjRemembered(stored), {
      tiles: [tile("Burial"), tile("Four Tet")],
      settings: { ...DEFAULT_DJ_SETTINGS, variety: "low" },
    });
  });

  test("no more tiles are read than a DJ seed holds", () => {
    const names = Array.from({ length: 40 }, (_, index) => `Artist ${index + 1}`);
    const stored = JSON.stringify({
      version: 1,
      tiles: names.map((name) => ({ kind: "artist", name })),
    });
    assert.deepEqual(
      readDjRemembered(stored).tiles.map((kept) => kept.name),
      names.slice(0, 30),
    );
  });
});

describe("DJ reopening", () => {
  const grid = [tile("Burial", 1), tile("Four Tet", 2), tile("Floating Points")];

  test("with nothing remembered it opens as the fresh grid, nothing selected", () => {
    assert.deepEqual(djReopened({ grid, remembered: [] }), djOpened(grid));
  });

  test("the fresh grid has the remembered tiles selected, in the order they were selected", () => {
    const state = djReopened({ grid, remembered: [tile("Floating Points"), tile("Burial")] });
    assert.deepEqual(state.tiles, grid);
    assert.deepEqual(djSeedTiles(state), [tile("Floating Points"), tile("Burial", 1)]);
    assert.equal(djCanStart(state), true);
  });

  test("a remembered tile the fresh grid wouldn't show is in it anyway, selected, ahead of the rest", () => {
    const state = djReopened({
      grid,
      remembered: [tile("Four Tet"), tile("Actress"), tile("Jon Hopkins")],
    });
    assert.deepEqual(
      state.tiles.map((shown) => shown.name),
      ["Actress", "Jon Hopkins", "Burial", "Four Tet", "Floating Points"],
    );
    assert.deepEqual(
      djSeedTiles(state).map((shown) => shown.name),
      ["Four Tet", "Actress", "Jon Hopkins"],
    );
  });

  test("a remembered tile outside the fresh grid shows the Library's artist when it has them", () => {
    const state = djReopened({
      grid,
      remembered: [tile("ACTRESS"), tile("Jon Hopkins")],
      artists: [
        { id: 7, name: "Actress" },
        { id: 8, name: "Burial" },
      ],
    });
    assert.deepEqual(state.tiles.slice(0, 2), [tile("Actress", 7), tile("Jon Hopkins")]);
  });

  test("a tile remembered twice, or past what a DJ seed holds, is selected once and within it", () => {
    const many = Array.from({ length: 40 }, (_, index) => tile(`Artist ${index + 1}`));
    const state = djReopened({ grid, remembered: [tile("Burial"), tile("burial"), ...many] });
    assert.equal(state.selected.length, 30);
    assert.equal(state.tiles.length, 29 + grid.length);
    assert.equal(new Set(state.selected).size, 30);
  });
});
