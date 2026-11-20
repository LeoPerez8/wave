import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DJ_GRID_TILES,
  DJ_MAX_SELECTED,
  djArtistTile,
  djGrid,
  djOpened,
  djReduce,
  djSelected,
  djCanStart,
  djSeedTiles,
  djSelectable,
  magicArtistKey,
  type DjTile,
  type TasteProfile,
} from "./index.ts";

/** A taste profile scoring [artists] by name. */
const tasteOf = (artists: Record<string, number>): TasteProfile => ({
  at: 0,
  songs: new Map(),
  artists: new Map(Object.entries(artists).map(([name, score]) => [magicArtistKey(name), score])),
  genres: new Map(),
});

/** A graph where each artist's page lists the others as "Fans might also like", closest first. */
const graphOf = (pages: Record<string, string[]>) =>
  artistGraph({
    catalog: [],
    pages: Object.entries(pages).map(([name, similar]) => ({
      name,
      similar: similar.map((other) => ({ name: other, browseId: `UC${other}`, audience: null })),
    })),
    plays: [],
  });

const names = (tiles: readonly DjTile[]): string[] => tiles.map((tile) => tile.name);

describe("DJ's grid", () => {
  test("shows the taste profile's highest-scored artists first", () => {
    const tiles = djGrid({
      artists: [
        { id: 1, name: "Portishead" },
        { id: 2, name: "Massive Attack" },
        { id: 3, name: "Tricky" },
      ],
      taste: tasteOf({ Portishead: 2, "Massive Attack": 9, Tricky: 5 }),
      graph: null,
    });
    assert.deepEqual(names(tiles), ["Massive Attack", "Tricky", "Portishead"]);
    assert.deepEqual(
      tiles.map((tile) => [tile.kind, tile.libraryId]),
      [
        ["artist", 2],
        ["artist", 3],
        ["artist", 1],
      ],
    );
  });

  test("puts after each favourite its closest neighbour the Library doesn't have", () => {
    const tiles = djGrid({
      artists: [
        { id: 1, name: "Portishead" },
        { id: 2, name: "Massive Attack" },
      ],
      taste: tasteOf({ "Massive Attack": 9, Portishead: 2 }),
      graph: graphOf({
        "Massive Attack": ["Portishead", "Tricky", "UNKLE"],
        Portishead: ["Beth Gibbons", "Tricky"],
      }),
    });
    assert.deepEqual(names(tiles), ["Massive Attack", "Tricky", "Portishead", "Beth Gibbons"]);
    assert.equal(tiles[1]!.libraryId, null);
  });

  test("shows no artist twice, however often the graph reaches them", () => {
    const tiles = djGrid({
      artists: [
        { id: 1, name: "Portishead" },
        { id: 2, name: "Massive Attack" },
        { id: 3, name: "portishead" },
      ],
      taste: tasteOf({ "Massive Attack": 9, Portishead: 2 }),
      graph: graphOf({ "Massive Attack": ["Tricky"], Portishead: ["Tricky"] }),
    });
    assert.deepEqual(names(tiles), ["Massive Attack", "Tricky", "Portishead"]);
  });

  test("leaves out the artists the owner skips", () => {
    const tiles = djGrid({
      artists: [
        { id: 1, name: "Portishead" },
        { id: 2, name: "Massive Attack" },
      ],
      taste: tasteOf({ "Massive Attack": -4, Portishead: 2 }),
      graph: null,
    });
    assert.deepEqual(names(tiles), ["Portishead"]);
  });

  test("holds at most 24 tiles", () => {
    const artists = Array.from({ length: 40 }, (_, at) => ({ id: at, name: `Artist ${at}` }));
    const tiles = djGrid({
      artists,
      taste: tasteOf(Object.fromEntries(artists.map((artist, at) => [artist.name, 100 - at]))),
      graph: null,
    });
    assert.equal(tiles.length, DJ_GRID_TILES);
    assert.equal(DJ_GRID_TILES, 24);
    assert.equal(tiles.at(-1)!.name, "Artist 23");
  });

  test("ranks by the most played artists before the taste profile was derived", () => {
    const tiles = djGrid({
      artists: [
        { id: 1, name: "Portishead" },
        { id: 2, name: "Massive Attack" },
      ],
      taste: null,
      played: [
        { id: 2, name: "Massive Attack", countedPlays: 40 },
        { id: "UC1", name: "Tricky", countedPlays: 12 },
        { id: 1, name: "Portishead", countedPlays: 3 },
      ],
      graph: graphOf({ Portishead: ["Beth Gibbons"] }),
    });
    assert.deepEqual(names(tiles), ["Massive Attack", "Tricky", "Portishead", "Beth Gibbons"]);
    assert.deepEqual(
      tiles.map((tile) => tile.libraryId),
      [2, null, 1, null],
    );
  });

  test("is empty with no taste signal and no plays", () => {
    assert.deepEqual(
      djGrid({ artists: [{ id: 1, name: "Portishead" }], taste: tasteOf({}), graph: null }),
      [],
    );
  });

  test("shows a favourite the Library doesn't have by the name the graph knows", () => {
    const tiles = djGrid({
      artists: [{ id: 1, name: "Portishead" }],
      taste: tasteOf({ Tricky: 6, Portishead: 2 }),
      graph: graphOf({ Portishead: ["Tricky"] }),
    });
    assert.deepEqual(names(tiles), ["Tricky", "Portishead"]);
  });
});

/** [count] artist tiles, "Artist 0" first. */
const artistTiles = (count: number): DjTile[] =>
  Array.from({ length: count }, (_, at) => djArtistTile(`Artist ${at}`, at)!);

describe("DJ's selection", () => {
  test("a tap selects a tile and another unselects it", () => {
    const [first, second] = artistTiles(2);
    const opened = djOpened([first!, second!]);
    assert.deepEqual(opened.selected, []);
    const selected = djReduce(opened, { type: "toggle", key: second!.key });
    assert.deepEqual(selected.selected, [second!.key]);
    assert.equal(djSelected(selected, second!.key), true);
    assert.equal(djSelected(selected, first!.key), false);
    assert.deepEqual(djReduce(selected, { type: "toggle", key: second!.key }).selected, []);
    assert.deepEqual(selected.tiles, opened.tiles);
  });

  test("a 31st tile can't be selected, and unselecting one frees its place", () => {
    const tiles = artistTiles(32);
    let state = djOpened(tiles);
    for (const tile of tiles.slice(0, 30)) state = djReduce(state, { type: "toggle", key: tile.key });
    assert.equal(state.selected.length, DJ_MAX_SELECTED);
    assert.equal(DJ_MAX_SELECTED, 30);
    assert.equal(djSelectable(state, tiles[30]!.key), false);
    assert.equal(djSelectable(state, tiles[0]!.key), true);
    const full = djReduce(state, { type: "toggle", key: tiles[30]!.key });
    assert.equal(full, state);
    const freed = djReduce(state, { type: "toggle", key: tiles[0]!.key });
    assert.equal(djSelectable(freed, tiles[30]!.key), true);
    assert.equal(djReduce(freed, { type: "toggle", key: tiles[30]!.key }).selected.length, 30);
  });

  test("Done needs at least one selected tile", () => {
    const tiles = artistTiles(2);
    const opened = djOpened(tiles);
    assert.equal(djCanStart(opened), false);
    const selected = djReduce(opened, { type: "toggle", key: tiles[1]!.key });
    assert.equal(djCanStart(selected), true);
    assert.deepEqual(djSeedTiles(selected), [tiles[1]]);
  });

  test("a tile the grid doesn't hold is never selected", () => {
    const opened = djOpened(artistTiles(2));
    const stray = djArtistTile("Somebody Else")!;
    assert.equal(djReduce(opened, { type: "toggle", key: stray.key }), opened);
  });

  test("the grid keeps each tile once", () => {
    const tiles = [djArtistTile("Portishead", 1)!, djArtistTile("PORTISHEAD")!, ...artistTiles(1)];
    assert.deepEqual(
      djOpened(tiles).tiles.map((tile) => tile.name),
      ["Portishead", "Artist 0"],
    );
  });

  test("the seed keeps the order the tiles were selected in", () => {
    const tiles = artistTiles(3);
    let state = djOpened(tiles);
    for (const at of [2, 0]) state = djReduce(state, { type: "toggle", key: tiles[at]!.key });
    assert.deepEqual(
      djSeedTiles(state).map((tile) => tile.name),
      ["Artist 2", "Artist 0"],
    );
  });
});
