import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DJ_MAX_SELECTED,
  djAlbumTile,
  djArtistTile,
  djOpened,
  djPagesNeeded,
  djReduce,
  djSearchTiles,
  djSeedFull,
  djSeedTiles,
  djSelectable,
  type ArtistGraph,
  type DjState,
  type DjTile,
} from "./index.ts";

/** A graph where each artist's page lists the others as "Fans might also like", closest first. */
const graphOf = (pages: Record<string, string[]>): ArtistGraph =>
  artistGraph({
    catalog: [],
    pages: Object.entries(pages).map(([name, similar]) => ({
      name,
      similar: similar.map((other) => ({ name: other, browseId: `UC${other}`, audience: null })),
    })),
    plays: [],
  });

const tile = (name: string, libraryId: number | null = null): DjTile =>
  djArtistTile(name, libraryId)!;

const names = (state: DjState): string[] => state.tiles.map((each) => each.name);

const selected = (state: DjState): string[] => djSeedTiles(state).map((each) => each.name);

describe("adding a search result to DJ's selection", () => {
  test("a result the grid doesn't show joins it first, selected", () => {
    const grid = djOpened([tile("Portishead"), tile("Tricky")]);
    const state = djReduce(grid, { type: "add", tile: tile("Burial") });
    assert.deepEqual(names(state), ["Burial", "Portishead", "Tricky"]);
    assert.deepEqual(selected(state), ["Burial"]);
  });

  test("it opens its similar artists right after it, as any selection does", () => {
    const grid = djOpened([tile("Portishead"), tile("Tricky")]);
    const graph = graphOf({ Burial: ["Four Tet", "Tricky", "Actress", "Zomby", "Andy Stott"] });
    const state = djReduce(grid, {
      type: "add",
      tile: tile("Burial"),
      graph,
      library: [{ id: 7, name: "Four Tet" }],
    });
    assert.deepEqual(names(state), [
      "Burial",
      "Four Tet",
      "Actress",
      "Zomby",
      "Portishead",
      "Tricky",
    ]);
    assert.equal(state.tiles[1]?.libraryId, 7);
    assert.deepEqual(djPagesNeeded(state), []);
  });

  test("an album result opens its album artist, then their similar artists", () => {
    const grid = djOpened([tile("Portishead")]);
    const untrue = djAlbumTile({ title: "Untrue", artist: "Burial", browseId: "MPREb_untrue" })!;
    const state = djReduce(grid, {
      type: "add",
      tile: untrue,
      graph: graphOf({ Burial: ["Four Tet", "Actress", "Zomby"] }),
    });
    assert.deepEqual(names(state), ["Untrue", "Burial", "Four Tet", "Actress", "Portishead"]);
    assert.deepEqual(selected(state), ["Untrue"]);
  });

  test("a result the grid already shows is selected where it is, not added again", () => {
    const grid = djOpened([tile("Portishead"), tile("Tricky", 3)]);
    const state = djReduce(grid, {
      type: "add",
      tile: tile("TRICKY"),
      graph: graphOf({ Tricky: ["Martina Topley-Bird"] }),
    });
    assert.deepEqual(names(state), ["Portishead", "Tricky", "Martina Topley-Bird"]);
    assert.deepEqual(selected(state), ["Tricky"]);
    assert.equal(state.tiles[1]?.libraryId, 3);
  });

  test("a result that's already selected stays selected", () => {
    const grid = djReduce(djOpened([tile("Portishead"), tile("Tricky")]), {
      type: "toggle",
      key: tile("Tricky").key,
    });
    const state = djReduce(grid, { type: "add", tile: tile("Tricky") });
    assert.deepEqual(names(state), ["Portishead", "Tricky"]);
    assert.deepEqual(selected(state), ["Tricky"]);
  });

  test("with 30 tiles selected a result can't be added, in the grid or not", () => {
    const tiles = Array.from({ length: DJ_MAX_SELECTED + 1 }, (_, at) => tile(`Artist ${at}`));
    const full = tiles
      .slice(0, DJ_MAX_SELECTED)
      .reduce((state, each) => djReduce(state, { type: "toggle", key: each.key }), djOpened(tiles));
    assert.equal(djSeedFull(full), true);
    assert.equal(djSeedFull(djReduce(full, { type: "toggle", key: tiles[0]!.key })), false);
    assert.equal(djSelectable(full, tile("Burial").key), false);
    assert.equal(djReduce(full, { type: "add", tile: tile("Burial") }), full);
    assert.equal(djReduce(full, { type: "add", tile: tiles[DJ_MAX_SELECTED]! }), full);
    // A selected one is still a result the search may show as picked.
    assert.equal(djSelectable(full, tiles[0]!.key), true);
  });
});

describe("the results of DJ's search", () => {
  test("are the artists and albums found, the Library's first, each once", () => {
    const tiles = djSearchTiles({
      artists: [
        { name: "Burial", libraryId: 4 },
        { name: "burial" },
        { name: "Various Artists" },
        { name: "Burial Hex" },
      ],
      albums: [
        { title: "Untrue", artist: "Burial", libraryId: 9, cover: "file:///untrue.jpg" },
        { title: "Untrue (Deluxe Edition)", artist: "Burial", browseId: "MPREb_untrue" },
        { title: "", artist: "Burial" },
        { title: "Kindred", artist: "Burial", browseId: "MPREb_kindred" },
      ],
    });
    assert.deepEqual(
      tiles.map((each) => [each.kind, each.name, each.libraryId]),
      [
        ["artist", "Burial", 4],
        ["artist", "Burial Hex", null],
        ["album", "Untrue", 9],
        ["album", "Kindred", null],
      ],
    );
  });
});
