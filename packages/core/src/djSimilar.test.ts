import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DJ_OPENED_TILES,
  djArtistTile,
  djCells,
  djOpened,
  djPageRead,
  djPagesNeeded,
  djReduce,
  djSeedTiles,
  djSelected,
  type ArtistGraph,
  type DjState,
  type DjSavedPage,
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

/** The grid as it's drawn: each tile's name, and "…" for a placeholder. */
const drawn = (state: DjState): string[] =>
  djCells(state).map((cell) => (cell.kind === "tile" ? cell.tile.name : "…"));

/** [state] after a tap on [name]'s tile, with [graph] known. */
const tap = (state: DjState, name: string, graph: ArtistGraph | null = null): DjState =>
  djReduce(state, { type: "toggle", key: tile(name).key, graph });

/** [state] after [name]'s page was read: its "Fans might also like" [similar], or null when it couldn't be. */
const page = (state: DjState, name: string, similar: readonly string[] | null): DjState =>
  djReduce(state, {
    type: "similar",
    key: tile(name).key,
    artists: similar === null ? null : similar.map((other) => ({ name: other })),
  });

describe("selecting an artist in DJ", () => {
  const graph = graphOf({
    Portishead: ["Massive Attack", "Tricky", "Beth Gibbons", "Morcheeba", "Lamb"],
  });

  test("opens the 3 closest graph neighbours right after it, with no page asked for", () => {
    const state = tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead", graph);
    assert.equal(DJ_OPENED_TILES, 3);
    assert.deepEqual(names(state), [
      "Portishead",
      "Massive Attack",
      "Tricky",
      "Beth Gibbons",
      "Air",
    ]);
    assert.deepEqual(drawn(state), names(state));
    assert.deepEqual(djPagesNeeded(state), []);
    assert.equal(djSelected(state, tile("Portishead").key), true);
    assert.equal(djSelected(state, tile("Tricky").key), false);
  });

  test("skips neighbours the grid already shows", () => {
    const state = tap(
      djOpened([tile("Tricky"), tile("Portishead"), tile("MASSIVE ATTACK")]),
      "Portishead",
      graph,
    );
    assert.deepEqual(names(state), [
      "Tricky",
      "Portishead",
      "Beth Gibbons",
      "Morcheeba",
      "Lamb",
      "MASSIVE ATTACK",
    ]);
    assert.deepEqual(djPagesNeeded(state), []);
  });

  test("shows the Library's artist on a tile it opens", () => {
    const state = djReduce(djOpened([tile("Portishead", 1)]), {
      type: "toggle",
      key: tile("Portishead").key,
      graph,
      library: [
        { id: 1, name: "Portishead" },
        { id: 7, name: "tricky" },
      ],
    });
    assert.deepEqual(
      state.tiles.map((each) => [each.name, each.libraryId]),
      [
        ["Portishead", 1],
        ["Massive Attack", null],
        ["tricky", 7],
        ["Beth Gibbons", null],
      ],
    );
  });

  test("with fewer than 3, asks for the artist's page and holds the row with placeholders", () => {
    const few = graphOf({ Portishead: ["Tricky"] });
    const state = tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead", few);
    assert.deepEqual(names(state), ["Portishead", "Tricky", "Air"]);
    assert.deepEqual(drawn(state), ["Portishead", "Tricky", "…", "…", "Air"]);
    assert.deepEqual(djPagesNeeded(state), [tile("Portishead")]);
  });

  test("with a cold graph, the whole row waits for the page", () => {
    const state = tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead");
    assert.deepEqual(drawn(state), ["Portishead", "…", "…", "…", "Air"]);
    assert.deepEqual(djPagesNeeded(state), [tile("Portishead")]);
  });

  test("the page fills the row up to 3, in its order, skipping tiles the grid shows", () => {
    const few = graphOf({ Portishead: ["Tricky"] });
    const waiting = tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead", few);
    const state = page(waiting, "Portishead", [
      "Air",
      "TRICKY",
      "Portishead",
      "Various Artists",
      "Lamb",
      "lamb",
      "Morcheeba",
      "Massive Attack",
    ]);
    assert.deepEqual(names(state), ["Portishead", "Tricky", "Lamb", "Morcheeba", "Air"]);
    assert.deepEqual(drawn(state), names(state));
    assert.deepEqual(djPagesNeeded(state), []);
  });

  test("a page with too few similar artists leaves a shorter row", () => {
    const waiting = tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead");
    const state = page(waiting, "Portishead", ["Lamb"]);
    assert.deepEqual(drawn(state), ["Portishead", "Lamb", "Air"]);
    assert.deepEqual(djPagesNeeded(state), []);
  });

  test("offline or on a failed read, the graph's neighbours stand", () => {
    const few = graphOf({ Portishead: ["Tricky"] });
    const waiting = tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead", few);
    const state = page(waiting, "Portishead", null);
    assert.deepEqual(drawn(state), ["Portishead", "Tricky", "Air"]);
    assert.deepEqual(djPagesNeeded(state), []);
  });

  test("unselecting keeps the tiles it opened, and selecting again opens no more", () => {
    const opened = tap(djOpened([tile("Portishead")]), "Portishead", graph);
    const unselected = tap(opened, "Portishead", graph);
    assert.equal(djSelected(unselected, tile("Portishead").key), false);
    assert.deepEqual(names(unselected), names(opened));
    const again = tap(unselected, "Portishead", graph);
    assert.deepEqual(names(again), names(opened));
    assert.deepEqual(djPagesNeeded(again), []);
  });

  test("unselecting while the page loads still fills the row", () => {
    const waiting = tap(tap(djOpened([tile("Portishead")]), "Portishead"), "Portishead");
    assert.deepEqual(drawn(waiting), ["Portishead", "…", "…", "…"]);
    assert.deepEqual(drawn(page(waiting, "Portishead", ["Lamb", "Tricky"])), [
      "Portishead",
      "Lamb",
      "Tricky",
    ]);
  });

  test("an opened tile can be selected and opens its own row", () => {
    const both = graphOf({
      Portishead: ["Massive Attack", "Tricky", "Beth Gibbons"],
      Tricky: ["Martina Topley-Bird", "Massive Attack", "Neneh Cherry", "Burial"],
    });
    const state = tap(tap(djOpened([tile("Portishead")]), "Portishead", both), "Tricky", both);
    assert.deepEqual(names(state), [
      "Portishead",
      "Massive Attack",
      "Tricky",
      "Martina Topley-Bird",
      "Neneh Cherry",
      "Burial",
      "Beth Gibbons",
    ]);
    assert.deepEqual(
      djSeedTiles(state).map((each) => each.name),
      ["Portishead", "Tricky"],
    );
  });

  test("a tile never appears twice when two pages list the same artist", () => {
    let state = tap(tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead"), "Air");
    assert.deepEqual(drawn(state), ["Portishead", "…", "…", "…", "Air", "…", "…", "…"]);
    state = page(state, "Air", ["Lamb", "Zero 7"]);
    assert.deepEqual(drawn(state), ["Portishead", "…", "…", "…", "Air", "Lamb", "Zero 7"]);
    state = page(state, "Portishead", ["Lamb", "Tricky"]);
    assert.deepEqual(drawn(state), ["Portishead", "Tricky", "Air", "Lamb", "Zero 7"]);
  });

  test("rows that wait at the same tile keep their order as the pages arrive", () => {
    const one = graphOf({ Portishead: ["Tricky"] });
    // Portishead opens Tricky and waits for 2; Tricky, selected next, waits for 3 right after itself.
    let state = tap(tap(djOpened([tile("Portishead"), tile("Air")]), "Portishead", one), "Tricky");
    assert.deepEqual(drawn(state), ["Portishead", "Tricky", "…", "…", "…", "…", "…", "Air"]);
    state = page(state, "Tricky", ["Burial", "Neneh Cherry", "Lamb"]);
    assert.deepEqual(drawn(state), [
      "Portishead",
      "Tricky",
      "…",
      "…",
      "Burial",
      "Neneh Cherry",
      "Lamb",
      "Air",
    ]);
    state = page(state, "Portishead", ["Morcheeba", "Zero 7"]);
    assert.deepEqual(names(state), [
      "Portishead",
      "Tricky",
      "Morcheeba",
      "Zero 7",
      "Burial",
      "Neneh Cherry",
      "Lamb",
      "Air",
    ]);
  });

  test("a page nobody waits for changes nothing", () => {
    const state = tap(djOpened([tile("Portishead")]), "Portishead", graph);
    assert.equal(page(state, "Portishead", ["Zero 7"]), state);
    assert.equal(page(state, "Somebody Else", ["Zero 7"]), state);
  });

  test("a tile the seed has no room for opens nothing", () => {
    const tiles = Array.from({ length: 31 }, (_, at) => tile(`Artist ${at}`));
    let state = djOpened(tiles);
    for (const each of tiles.slice(0, 30))
      state = djReduce(state, { type: "toggle", key: each.key });
    assert.equal(djReduce(state, { type: "toggle", key: tiles[30]!.key, graph: null }), state);
  });
});

describe("the page DJ reads for a tile", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const found = (checkedAt: number, similar?: string[]): DjSavedPage => ({
    outcome: "found",
    checkedAt,
    page: similar === undefined ? {} : { similar: similar.map((name) => ({ name })) },
  });
  const listed = (read: ReturnType<typeof djPageRead>): string[] | null =>
    read.artists?.map((artist) => artist.name) ?? null;

  test("is asked for when nothing is saved", () => {
    assert.deepEqual(djPageRead(null, 0), { ask: true, artists: null });
  });

  test("isn't asked for again within a week of a saved answer", () => {
    const read = djPageRead(found(0, ["Tricky", "Lamb"]), 6 * DAY);
    assert.equal(read.ask, false);
    assert.deepEqual(listed(read), ["Tricky", "Lamb"]);
    assert.deepEqual(djPageRead({ outcome: "unmatched", checkedAt: 0 }, 6 * DAY), {
      ask: false,
      artists: null,
    });
  });

  test("is asked for again after a week, the saved list standing if the read fails", () => {
    const read = djPageRead(found(0, ["Tricky"]), 8 * DAY);
    assert.equal(read.ask, true);
    assert.deepEqual(listed(read), ["Tricky"]);
  });

  test("a saved page with no similar artists lists none", () => {
    assert.deepEqual(djPageRead(found(0), DAY), { ask: false, artists: [] });
  });
});
