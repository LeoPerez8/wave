import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DJ_GRID_TILES,
  djAlbumTile,
  djArtistTile,
  djGrid,
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

/** Each tile as the owner tells it apart: a circle's name, or a square's title and artist. */
const shown = (tiles: readonly DjTile[]): string[] =>
  tiles.map((tile) => (tile.kind === "album" ? `[${tile.name} / ${tile.artist}]` : tile.name));

describe("albums in DJ's grid", () => {
  test("an album tile carries its title, its album artist and where its cover comes from", () => {
    assert.deepEqual(
      djAlbumTile({
        title: "Dummy",
        artist: "Portishead",
        libraryId: 7,
        browseId: "MPREb_dummy",
        artworkUrl: "https://covers/dummy",
      }),
      {
        kind: "album",
        key: djAlbumTile({ title: "Dummy", artist: "Portishead" })!.key,
        name: "Dummy",
        artist: "Portishead",
        libraryId: 7,
        browseId: "MPREb_dummy",
        artworkUrl: "https://covers/dummy",
      },
    );
    assert.equal(djAlbumTile({ title: "  ", artist: "Portishead" }), null);
  });

  test("an album and an artist of the same name are different tiles", () => {
    assert.notEqual(
      djAlbumTile({ title: "Portishead", artist: "Portishead" })!.key,
      djArtistTile("Portishead")!.key,
    );
  });

  test("albums are told apart by title and album artist, whatever the case or the edition", () => {
    const key = (title: string, artist: string) => djAlbumTile({ title, artist })!.key;
    assert.equal(key("Dummy", "Portishead"), key("DUMMY (Deluxe Edition)", "portishead"));
    assert.notEqual(key("Dummy", "Portishead"), key("Third", "Portishead"));
    assert.notEqual(key("Greatest Hits", "Queen"), key("Greatest Hits", "ABBA"));
  });

  test("each artist of the grid is followed by an album of theirs", () => {
    const tiles = djGrid({
      artists: [
        { id: 1, name: "Portishead" },
        { id: 2, name: "Massive Attack" },
      ],
      taste: tasteOf({ Portishead: 9, "Massive Attack": 5 }),
      graph: graphOf({ Portishead: ["Tricky"] }),
      albums: [
        { title: "Mezzanine", artist: "Massive Attack", libraryId: 11 },
        { title: "Dummy", artist: "Portishead", libraryId: 12 },
        { title: "Third", artist: "Portishead", libraryId: 13 },
        { title: "Maxinquaye", artist: "Tricky", browseId: "MPREb_max" },
        { title: "Homogenic", artist: "Björk", libraryId: 14 },
      ],
    });
    assert.deepEqual(shown(tiles), [
      "Portishead",
      "[Dummy / Portishead]",
      "Tricky",
      "[Maxinquaye / Tricky]",
      "Massive Attack",
      "[Mezzanine / Massive Attack]",
    ]);
    assert.deepEqual(
      tiles.flatMap((tile) => (tile.kind === "album" ? [[tile.libraryId, tile.browseId]] : [])),
      [
        [12, null],
        [null, "MPREb_max"],
        [11, null],
      ],
    );
  });

  test("an artist with no known album stands alone", () => {
    const tiles = djGrid({
      artists: [{ id: 1, name: "Portishead" }],
      taste: tasteOf({ Portishead: 9 }),
      graph: null,
      albums: [],
    });
    assert.deepEqual(shown(tiles), ["Portishead"]);
  });

  test("albums count toward the grid's 24 tiles", () => {
    const artists = Array.from({ length: 30 }, (_, at) => ({ id: at, name: `Artist ${at}` }));
    const tiles = djGrid({
      artists,
      taste: tasteOf(Object.fromEntries(artists.map((artist, at) => [artist.name, 100 - at]))),
      graph: null,
      albums: artists.map((artist) => ({ title: `Record of ${artist.name}`, artist: artist.name })),
    });
    assert.equal(tiles.length, DJ_GRID_TILES);
    assert.equal(tiles.filter((tile) => tile.kind === "album").length, 12);
  });
});
