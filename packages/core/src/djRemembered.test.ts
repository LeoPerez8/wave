import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_DJ_SETTINGS,
  djAlbumTile,
  djArtistTile,
  djCanStart,
  djGenreTile,
  djGrid,
  djOpened,
  djReopened,
  djSeedTiles,
  readDjRemembered,
  storedDjRemembered,
  type DjAlbum,
  type DjSettings,
} from "./index.ts";

const tile = (name: string, libraryId: number | null = null) => {
  const made = djArtistTile(name, libraryId);
  assert.ok(made);
  return made;
};

const albumTile = (album: DjAlbum) => {
  const made = djAlbumTile(album);
  assert.ok(made);
  return made;
};

const chosen: DjSettings = {
  variety: "high",
  discovery: "familiar",
  popularity: "trending",
  newReleases: true,
  mood: ["energetic", "relaxing"],
};

describe("what DJ remembers on the phone", () => {
  test("a selected family comes back with its family name", () => {
    const family = djGenreTile("Dubstep");
    assert.ok(family);
    const stored = storedDjRemembered({ tiles: [family], settings: chosen });
    const read = readDjRemembered(stored);
    assert.deepEqual(read.tiles, [family]);
  });
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

  test("an older build reads the first of several remembered moods", () => {
    const stored = storedDjRemembered({ tiles: [tile("Burial")], settings: chosen });
    assert.equal(JSON.parse(stored!).settings.mood, "energetic");
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
        // A kind this Wave doesn't know.
        { kind: "mood", name: "Focus" },
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

describe("a remembered album", () => {
  const untrue: DjAlbum = {
    title: "Untrue",
    artist: "Burial",
    libraryId: 4,
    browseId: "MPREb_untrue",
    cover: "https://covers.example/untrue.jpg",
  };

  test("reads back with its title, album artist, page and cover, beside the artists", () => {
    const tiles = [tile("Four Tet"), albumTile(untrue)];
    const read = readDjRemembered(storedDjRemembered({ tiles, settings: chosen }));
    // The Library's album is found again as DJ reopens, so its id isn't kept.
    assert.deepEqual(read.tiles, [tile("Four Tet"), { ...albumTile(untrue), libraryId: null }]);
    assert.deepEqual(read.settings, chosen);
  });

  test("with no title or album artist it is left out and the rest stand", () => {
    const stored = JSON.stringify({
      version: 1,
      tiles: [
        { kind: "album", name: "Untrue" },
        { kind: "album", name: "", artist: "Burial" },
        { kind: "album", name: "Kindred", artist: "Burial", browseId: 7, cover: null },
      ],
      settings: chosen,
    });
    assert.deepEqual(readDjRemembered(stored).tiles, [
      albumTile({ title: "Kindred", artist: "Burial" }),
    ]);
  });

  test("is selected in the fresh grid that shows it, as the grid shows it", () => {
    const grid = [tile("Burial", 1), albumTile(untrue), tile("Four Tet", 2)];
    const remembered = readDjRemembered(
      storedDjRemembered({ tiles: [albumTile(untrue)], settings: chosen }),
    ).tiles;
    const state = djReopened({ grid, remembered });
    assert.deepEqual(state.tiles, grid);
    assert.deepEqual(djSeedTiles(state), [albumTile(untrue)]);
  });

  test("outside the fresh grid it is in it anyway, as the Library's album when it's known", () => {
    const grid = [tile("Four Tet", 2)];
    const remembered = readDjRemembered(
      storedDjRemembered({
        tiles: [albumTile(untrue), albumTile({ title: "Kindred", artist: "Burial" })],
        settings: chosen,
      }),
    ).tiles;
    const state = djReopened({ grid, remembered, albums: [untrue] });
    assert.deepEqual(state.tiles, [
      albumTile(untrue),
      albumTile({ title: "Kindred", artist: "Burial" }),
      ...grid,
    ]);
    assert.deepEqual(djSeedTiles(state), state.tiles.slice(0, 2));
  });

  test("a Library compilation, which the grid never shows, comes back as the Library's", () => {
    const tales: DjAlbum = {
      title: "Late Night Tales",
      artist: "Bonobo",
      libraryId: 9,
      cover: "file:///covers/9.jpg",
      compilation: true,
    };
    const albums = [tales];
    const grid = djGrid({
      artists: [{ id: 3, name: "Bonobo" }],
      taste: null,
      played: [{ id: 3, name: "Bonobo", countedPlays: 5 }],
      graph: null,
      albums,
    });
    assert.deepEqual(grid, [tile("Bonobo", 3)]);
    const remembered = readDjRemembered(
      storedDjRemembered({ tiles: [albumTile(tales)], settings: chosen }),
    ).tiles;
    const state = djReopened({ grid, remembered, albums });
    assert.deepEqual(djSeedTiles(state), [albumTile(tales)]);
  });

  test("is not taken for the artist of the same name", () => {
    const self = albumTile({ title: "Burial", artist: "Burial" });
    const state = djReopened({ grid: [tile("Burial", 1)], remembered: [self] });
    assert.deepEqual(state.tiles, [self, tile("Burial", 1)]);
    assert.deepEqual(djSeedTiles(state), [self]);
  });
});

describe("DJ reopening", () => {
  const grid = [tile("Burial", 1), tile("Four Tet", 2), tile("Floating Points")];

  test("a remembered family is selected only while Genre mixes still has its seed artists", () => {
    const family = djGenreTile("Rock")!;
    const artists = [{ id: 1, name: "Rock Artist" }];
    const genreLibrary = {
      artists,
      songs: [
        {
          id: 1,
          title: "Rock song",
          artist: "Rock Artist",
          artistIds: [1],
          durationMs: 180_000,
          addedAt: 0,
          genre: "Rock",
        },
      ],
    };
    const restored = djReopened({ grid: [], remembered: [family], genreLibrary });
    assert.deepEqual(
      djSeedTiles(restored).map((tile) => tile.kind),
      ["genre"],
    );
    assert.deepEqual(restored.tiles[0]?.kind === "genre" ? restored.tiles[0].artists : [], artists);
    assert.deepEqual(djSeedTiles(djReopened({ grid: [], remembered: [family] })), []);
  });

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
