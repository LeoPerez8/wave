import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DJ_GRID_TILES,
  DJ_MAX_SELECTED,
  djAlbumTile,
  djArtistTile,
  djCells,
  djGrid,
  djOpened,
  djPagesNeeded,
  djReduce,
  djSelectable,
  djSelected,
  magicArtistKey,
  magicBatchRadios,
  parseMagicSession,
  startDjQueue,
  type ArtistGraph,
  type DjArtistTile,
  type DjState,
  type DjTile,
  type MagicSeedSong,
  type MagicSession,
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
        cover: "https://covers/dummy",
      }),
      {
        kind: "album",
        key: djAlbumTile({ title: "Dummy", artist: "Portishead" })!.key,
        name: "Dummy",
        artist: "Portishead",
        libraryId: 7,
        browseId: "MPREb_dummy",
        cover: "https://covers/dummy",
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

/** [state]'s grid as it's drawn: each tile as `shown` tells it, and "…" for a placeholder. */
const drawn = (state: DjState): string[] =>
  djCells(state).map((cell) => (cell.kind === "tile" ? shown([cell.tile])[0]! : "…"));

describe("selecting an album in DJ", () => {
  const dummy = djAlbumTile({ title: "Dummy", artist: "Portishead" })!;
  const graph = graphOf({ Portishead: ["Tricky", "Massive Attack", "Morcheeba", "Lamb"] });
  const tap = (state: DjState, key: DjTile["key"], known: ArtistGraph | null = graph): DjState =>
    djReduce(state, { type: "toggle", key, graph: known });

  test("opens its album artist first, then that artist's similar artists, 3 tiles in all", () => {
    const state = tap(djOpened([dummy, djArtistTile("Air")!]), dummy.key);
    assert.deepEqual(drawn(state), [
      "[Dummy / Portishead]",
      "Portishead",
      "Tricky",
      "Massive Attack",
      "Air",
    ]);
    assert.equal(djSelected(state, dummy.key), true);
    assert.deepEqual(djPagesNeeded(state), []);
  });

  test("opens 3 similar artists when the grid already shows its album artist", () => {
    const state = tap(djOpened([djArtistTile("Portishead")!, dummy]), dummy.key);
    assert.deepEqual(drawn(state), [
      "Portishead",
      "[Dummy / Portishead]",
      "Tricky",
      "Massive Attack",
      "Morcheeba",
    ]);
  });

  test("shows the Library's artist on the album artist's tile", () => {
    const state = djReduce(djOpened([dummy]), {
      type: "toggle",
      key: dummy.key,
      graph: null,
      library: [{ id: 4, name: "Portishead" }],
    });
    assert.deepEqual(state.tiles[1], djArtistTile("Portishead", 4));
  });

  test("with fewer than 3, waits for its album artist's page, which fills the row", () => {
    const waiting = tap(djOpened([dummy]), dummy.key, graphOf({ Portishead: ["Tricky"] }));
    assert.deepEqual(drawn(waiting), ["[Dummy / Portishead]", "Portishead", "Tricky", "…"]);
    assert.deepEqual(
      djPagesNeeded(waiting).map((page) => page.artist),
      ["Portishead"],
    );
    const filled = djReduce(waiting, {
      type: "similar",
      artist: "Portishead",
      artists: [{ name: "Tricky" }, { name: "Lamb" }, { name: "Morcheeba" }],
    });
    assert.deepEqual(drawn(filled), ["[Dummy / Portishead]", "Portishead", "Tricky", "Lamb"]);
    assert.deepEqual(djPagesNeeded(filled), []);
  });

  test("its row and its album artist's row wait for one read of the artist's page", () => {
    const album = tap(djOpened([dummy]), dummy.key, null);
    const both = tap(album, djArtistTile("PORTISHEAD")!.key, null);
    assert.deepEqual(drawn(both), ["[Dummy / Portishead]", "Portishead", "…", "…", "…", "…", "…"]);
    assert.deepEqual(djPagesNeeded(both), [{ artist: "Portishead", key: "portishead" }]);
    const filled = djReduce(both, {
      type: "similar",
      artist: "portishead",
      artists: ["Tricky", "Lamb", "Morcheeba", "Massive Attack", "Beth Gibbons"].map((name) => ({
        name,
      })),
    });
    assert.deepEqual(drawn(filled), [
      "[Dummy / Portishead]",
      "Portishead",
      "Tricky",
      "Lamb",
      "Morcheeba",
      "Massive Attack",
      "Beth Gibbons",
    ]);
    assert.deepEqual(djPagesNeeded(filled), []);
  });

  test("an album by nobody in particular opens nothing and waits for no page", () => {
    const hits = djAlbumTile({ title: "Trip Hop Hits", artist: "Various Artists" })!;
    const state = tap(djOpened([hits]), hits.key);
    assert.deepEqual(drawn(state), ["[Trip Hop Hits / Various Artists]"]);
    assert.equal(djSelected(state, hits.key), true);
  });

  test("unselecting it keeps the tiles it opened", () => {
    const state = tap(tap(djOpened([dummy]), dummy.key), dummy.key);
    assert.equal(djSelected(state, dummy.key), false);
    assert.deepEqual(drawn(state), [
      "[Dummy / Portishead]",
      "Portishead",
      "Tricky",
      "Massive Attack",
    ]);
  });

  test("the same album never joins the grid twice", () => {
    const state = djOpened([
      dummy,
      djAlbumTile({ title: "dummy (Remastered)", artist: "PORTISHEAD" })!,
    ]);
    assert.deepEqual(drawn(state), ["[Dummy / Portishead]"]);
  });

  test("albums count toward the 30 tiles a seed holds", () => {
    const albums = Array.from({ length: DJ_MAX_SELECTED }, (_, at) =>
      djAlbumTile({ title: `Record ${at}`, artist: "Various Artists" })!,
    );
    const air = djArtistTile("Air")!;
    let state = djOpened([...albums, air]);
    for (const album of albums) state = tap(state, album.key, null);
    assert.equal(state.selected.length, DJ_MAX_SELECTED);
    assert.equal(djSelectable(state, air.key), false);
    assert.equal(djSelected(tap(state, air.key, null), air.key), false);
  });
});

describe("an album in the DJ seed", () => {
  const dummy = djAlbumTile({ title: "Dummy", artist: "Portishead", libraryId: 12 })!;
  const song = (id: number, title: string, artist: string, plays = 0): MagicSeedSong => ({
    id: `song:${id}`,
    title,
    artists: [artist],
    durationMs: 200_000,
    plays,
  });
  const dummySongs = [
    song(1, "Mysterons", "Portishead", 4),
    song(2, "Sour Times", "Portishead", 9),
    song(3, "Glory Box", "Portishead"),
  ];
  /** The radios each of [batches] batches of [session] reads, by seed id. */
  const radiosOf = (session: MagicSession, batches: number): string[][] => {
    const drawn: string[][] = [];
    let now = session;
    for (let batch = 0; batch < batches; batch++) {
      const next = magicBatchRadios(now, () => 0.5);
      drawn.push(next.seeds.map((seed) => seed.id));
      now = { ...next.session, batches: now.batches + 1 };
    }
    return drawn;
  };

  test("contributes its songs as list seed songs, as an album seed does", () => {
    const session = startDjQueue([dummy], {
      id: "s",
      albumSongs: new Map([[dummy.key, dummySongs]]),
    })!;
    assert.deepEqual(session.seed, { kind: "dj", id: "s", title: "DJ" });
    assert.deepEqual(session.seedSongs, dummySongs);
    assert.deepEqual(session.radioArtists, ["Portishead"]);
    assert.deepEqual(session.used, []);
  });

  test("each batch reads one of its songs' radios, a different one each time", () => {
    const session = startDjQueue([dummy], {
      id: "s",
      albumSongs: new Map([[dummy.key, dummySongs]]),
    })!;
    const drawn = radiosOf(session, 3);
    assert.deepEqual(
      drawn.map((ids) => ids.length),
      [1, 1, 1],
    );
    assert.deepEqual(new Set(drawn.flat()), new Set(["song:1", "song:2", "song:3"]));
  });

  test("artists and albums share the draw of up to 3 radios by different artists", () => {
    const tiles = [
      djArtistTile("Portishead")!,
      dummy,
      djArtistTile("Tricky")!,
      djArtistTile("Air")!,
      djArtistTile("Lamb")!,
    ];
    const session = startDjQueue(tiles, {
      id: "s",
      albumSongs: new Map([[dummy.key, dummySongs]]),
    })!;
    assert.equal(session.seedSongs!.length, 7);
    const artistOf = new Map(session.seedSongs!.map((seed) => [seed.id, seed.artists[0]]));
    const drawn = radiosOf(session, 4);
    const selectedIds = tiles
      .filter((tile): tile is DjArtistTile => tile.kind === "artist")
      .map((tile): string => tile.key);
    assert.deepEqual(
      drawn[0]!.filter((id) => selectedIds.includes(id)),
      selectedIds,
    );
    for (const ids of drawn.slice(1)) {
      assert.ok(ids.length <= 3);
      const artists = ids.map((id) => artistOf.get(id));
      assert.equal(new Set(artists).size, artists.length);
    }
    const firstBatchExtras = drawn[0]!.filter((id) => !selectedIds.includes(id));
    assert.ok(firstBatchExtras.length <= 3);
    assert.equal(radiosOf(session, 1)[0]!.length, selectedIds.length);
  });

  test("an album whose songs couldn't be read stands for its album artist's radio", () => {
    const session = startDjQueue([dummy], {
      id: "s",
      played: [{ id: 4, name: "Portishead", countedPlays: 6 }],
    })!;
    assert.deepEqual(session.seedSongs, [
      {
        id: djArtistTile("Portishead")!.key,
        title: "Portishead",
        artists: ["Portishead"],
        durationMs: null,
        kind: "artist",
        plays: 6,
      },
    ]);
  });

  test("an album and its selected artist give that artist's radio once", () => {
    const session = startDjQueue([djArtistTile("Portishead")!, dummy], { id: "s" })!;
    assert.equal(session.seedSongs!.length, 1);
    assert.deepEqual(session.radioArtists, ["Portishead"]);
  });

  test("a compilation's songs bring their own artists to the session", () => {
    const hits = djAlbumTile({ title: "Trip Hop Hits", artist: "Various Artists" })!;
    const session = startDjQueue([hits], {
      id: "s",
      albumSongs: new Map([
        [
          hits.key,
          [song(5, "Teardrop", "Massive Attack"), song(6, "6 Underground", "Sneaker Pimps")],
        ],
      ]),
    })!;
    assert.deepEqual(session.radioArtists, ["Massive Attack", "Sneaker Pimps"]);
  });

  test("a seed with no radio to read starts nothing", () => {
    const hits = djAlbumTile({ title: "Trip Hop Hits", artist: "Various Artists" })!;
    assert.equal(startDjQueue([hits], { id: "s" }), null);
  });

  test("survives a restart with its album's songs", () => {
    const session = startDjQueue([dummy, djArtistTile("Air")!], {
      id: "s",
      albumSongs: new Map([[dummy.key, dummySongs]]),
    })!;
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(session))), session);
  });
});
