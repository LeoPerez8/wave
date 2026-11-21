import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  artistGraph,
  DJ_GRID_TILES,
  DJ_MAX_SELECTED,
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  djArtistTile,
  djAlbumTile,
  djFamilyRadioAllowed,
  djGenreTile,
  djNewToYou,
  djRadioSongAllowed,
  djFirstLibrarySong,
  djGrid,
  djOpened,
  djReduce,
  djReopened,
  genreMixDjCandidates,
  djSelected,
  startDjQueue,
  DEFAULT_DJ_SETTINGS,
  magicBatchRadios,
  magicQueueLabel,
  magicSessionSliders,
  parseMagicSession,
  completeMagicRadioBatch,
  startStreamedMagicQueue,
  ytTrackId,
  type RankedRadioSong,
  djCanStart,
  djSeedTiles,
  djSelectable,
  magicArtistKey,
  reduceQueue,
  wantsMagicBatch,
  type DjTile,
  type TasteProfile,
} from "./index.ts";

test("DJ can take its first playable Library song from the selected artist or album", () => {
  const artist = djArtistTile("Portishead")!;
  const album = djAlbumTile({ title: "Dummy", artist: "Portishead", libraryId: 42 })!;
  const songs = [
    { id: 1, path: null, albumId: 2, artistIds: [7], artistNames: ["Portishead"], genre: null },
    {
      id: 2,
      path: "song.flac",
      albumId: 2,
      artistIds: [7],
      artistNames: ["Portishead"],
      genre: null,
    },
    { id: 3, path: "album.flac", albumId: 42, artistIds: [9], artistNames: ["Other"], genre: null },
    {
      id: 4,
      path: "family.flac",
      albumId: 2,
      artistIds: [10],
      artistNames: ["Metal Act"],
      genre: "Metal",
    },
  ];
  assert.equal(djFirstLibrarySong([artist], songs)?.id, 2);
  assert.equal(djFirstLibrarySong([album], songs)?.id, 3);
  const family = { ...djGenreTile("Metal")!, artists: [{ id: 10, name: "Metal Act" }] };
  assert.equal(djFirstLibrarySong([family], songs)?.id, 4);
});

test("DJ's first Library song follows candidate ranking, exclusions and randomized ties", () => {
  const artist = djArtistTile("Portishead")!;
  const songs = [
    {
      id: 2,
      path: "first.flac",
      albumId: 1,
      artistIds: [7],
      artistNames: ["Portishead"],
      genre: null,
    },
    {
      id: 3,
      path: "second.flac",
      albumId: 1,
      artistIds: [7],
      artistNames: ["Portishead"],
      genre: null,
    },
  ];
  const ranked = (id: number) => (id === 2 ? 1 : 2);
  assert.equal(djFirstLibrarySong([artist], songs, { scoreOf: (song) => ranked(song.id) })?.id, 3);
  assert.equal(
    djFirstLibrarySong([artist], songs, {
      scoreOf: (song) => ranked(song.id),
      excluded: new Set(["3"]),
    })?.id,
    2,
  );
  assert.equal(
    djFirstLibrarySong([artist], songs, {
      scoreOf: () => 1,
      random: () => 0.99,
    })?.id,
    3,
  );
});

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
  test("offers up to four known genre families in taste order among its artist tiles", () => {
    const artists = [
      { id: 1, name: "Metal Artist" },
      { id: 2, name: "Pop Artist" },
      { id: 3, name: "Rock Artist" },
      { id: 4, name: "Jazz Artist" },
      { id: 5, name: "Folk Artist" },
    ];
    const songs = artists.flatMap((artist, index) =>
      Array.from({ length: 5 }, (_, song) => ({
        id: index * 5 + song + 1,
        title: `Song ${index}-${song}`,
        artist: artist.name,
        artistIds: [artist.id],
        durationMs: 180_000,
        addedAt: 0,
        genre: ["Metal", "Pop", "Rock", "Jazz", "Folk"][index]!,
      })),
    );
    const tiles = djGrid({
      artists,
      taste: {
        ...tasteOf({}),
        genres: new Map([
          ["metal", 2],
          ["pop", 10],
          ["rock", 8],
          ["jazz", 6],
          ["folk", 4],
        ]),
      },
      graph: null,
      genreLibrary: { artists, songs },
    });
    assert.deepEqual(
      tiles.filter((tile) => tile.kind === "genre").map((tile) => tile.name),
      ["Pop", "Rock", "Jazz", "Folk"],
    );
  });

  test("leaves out a family that has no seed artist and shows none for an empty Library", () => {
    const songs = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      title: `Song ${index}`,
      artist: "Various Artists",
      artistIds: [],
      durationMs: 180_000,
      addedAt: 0,
      genre: "Pop",
    }));
    const taste = { ...tasteOf({}), genres: new Map([["pop", 3]]) };
    assert.deepEqual(
      djGrid({ artists: [], taste, graph: null, genreLibrary: { artists: [], songs } }),
      [],
    );
    assert.deepEqual(
      djGrid({ artists: [], taste: null, graph: null, genreLibrary: { artists: [], songs: [] } }),
      [],
    );
  });

  test("offers a family as soon as it knows one seedable artist", () => {
    const artists = [{ id: 1, name: "One Pop Artist" }];
    const tile = djGrid({
      artists,
      taste: { ...tasteOf({}), genres: new Map([["pop", 2]]) },
      graph: null,
      genreLibrary: {
        artists,
        songs: [
          {
            id: 1,
            title: "One Pop Song",
            artist: "One Pop Artist",
            artistIds: [1],
            durationMs: 180_000,
            addedAt: 0,
            genre: "Pop",
          },
        ],
      },
    });
    assert.deepEqual(
      tile.filter((candidate) => candidate.kind === "genre").map(({ name }) => name),
      ["Pop"],
    );
  });

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
  test("takes family candidates worked out once in place of the Library inputs", () => {
    const artists = [{ id: 1, name: "Rock Artist" }];
    const songs = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      title: `Rock ${index}`,
      artist: "Rock Artist",
      artistIds: [1],
      durationMs: 180_000,
      addedAt: 0,
      genre: "Rock",
    }));
    const genreCandidates = genreMixDjCandidates({ artists, songs });
    const taste = { ...tasteOf({}), genres: new Map([["rock", 1]]) };
    const family = djGrid({ artists, taste, graph: null, genreCandidates }).find(
      (tile) => tile.kind === "genre",
    );
    assert.equal(family?.name, "Rock");
    const reopened = djReopened({
      grid: [],
      remembered: [djGenreTile("Rock")!],
      artists,
      genreCandidates,
    });
    assert.deepEqual(
      djSeedTiles(reopened).map((tile) => (tile.kind === "genre" ? tile.artists : [])),
      [artists],
    );
  });
});

/** [count] artist tiles, "Artist 0" first. */
const artistTiles = (count: number): DjTile[] =>
  Array.from({ length: count }, (_, at) => djArtistTile(`Artist ${at}`, at)!);

describe("DJ's selection", () => {
  test("a family opens its highest-taste artists immediately, without a page row", () => {
    const artists = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      name: `Pop ${index}`,
    }));
    const songs = artists.flatMap((artist, index) =>
      Array.from({ length: 5 }, (_, song) => ({
        id: index * 5 + song + 1,
        title: `Song ${index}-${song}`,
        artist: artist.name,
        artistIds: [artist.id],
        durationMs: 180_000,
        addedAt: 0,
        genre: "Pop",
      })),
    );
    const tiles = djGrid({
      artists,
      taste: {
        ...tasteOf(Object.fromEntries(artists.map((artist, index) => [artist.name, 30 - index]))),
        genres: new Map([["pop", 9]]),
      },
      graph: null,
      genreLibrary: { artists, songs },
    });
    const family = tiles.find((tile) => tile.kind === "genre");
    assert.ok(family);
    const state = djReduce(djOpened(tiles), { type: "toggle", key: family.key });
    assert.deepEqual(
      state.tiles
        .slice(
          state.tiles.findIndex((tile) => tile.key === family.key) + 1,
          state.tiles.findIndex((tile) => tile.key === family.key) + 4,
        )
        .map((tile) => tile.name),
      ["Pop 23", "Pop 24", "Pop 25"],
    );
    assert.equal(state.rows[0]?.waiting, 0);
  });

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
    for (const tile of tiles.slice(0, 30))
      state = djReduce(state, { type: "toggle", key: tile.key });
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

/** A ranked radio song by [artist]. */
const rankedSong = (videoId: string, artist: string): RankedRadioSong => ({
  trackId: ytTrackId(videoId),
  artists: [magicArtistKey(artist)],
  genre: null,
  style: null,
  source: "stream",
  song: {
    videoId,
    title: `Song ${videoId}`,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  radio: { id: "artist:artist 0", position: 0 },
  score: 10,
});

describe("a Magic Queue with a DJ seed", () => {
  const tiles = artistTiles(5);
  const started = () => startDjQueue(tiles, { id: "dj1" })!;

  test("a family radio keeps its family, excludes a known mismatch and leaves unknown genre neutral", () => {
    const profileOf = (artist: string) =>
      artist === "Metal Band"
        ? new Map([["metal", 1]])
        : artist === "Mixed Band"
          ? new Map([
              ["metal", 0.3],
              ["pop", 0.7],
            ])
          : artist === "Pop Band"
            ? new Map([["pop", 1]])
            : null;
    assert.equal(djFamilyRadioAllowed("metal", ["Metal Band"], profileOf), true);
    assert.equal(djFamilyRadioAllowed("metal", ["Mixed Band"], profileOf), false);
    assert.equal(djFamilyRadioAllowed("metal", ["Pop Band"], profileOf), false);
    assert.equal(djFamilyRadioAllowed("metal", ["Unknown"], profileOf), true);
  });

  test("a radio artist without tags inherits a family from graph neighbours", () => {
    const profileOf = (artist: string) =>
      artist === "Pop Neighbour" ? new Map([["pop", 1]]) : null;
    assert.equal(
      djFamilyRadioAllowed(
        "metal",
        ["Untagged Artist"],
        profileOf,
        graphOf({ "Untagged Artist": ["Pop Neighbour"] }),
      ),
      false,
    );
  });

  const familyProfileOf = (artist: string) =>
    artist === "Metal Band"
      ? new Map([["metal", 1]])
      : artist === "Pop Band"
        ? new Map([["pop", 1]])
        : artist === "Jazz Band"
          ? new Map([["jazz", 1]])
          : null;
  const familyTile = (name: string, artist: string): DjTile => ({
    ...djGenreTile(name)!,
    artists: [{ id: 1, name: artist }],
  });

  test("a song on a radio two families share passes when it fits either family", () => {
    const session = startDjQueue(
      [familyTile("Metal", "Shared Artist"), familyTile("Pop", "Shared Artist")],
      {
        id: "dj-two-families",
      },
    )!;
    const radio = "artist:shared artist";
    assert.equal(djRadioSongAllowed(session, radio, ["Metal Band"], familyProfileOf), true);
    assert.equal(djRadioSongAllowed(session, radio, ["Pop Band"], familyProfileOf), true);
    assert.equal(djRadioSongAllowed(session, radio, ["Jazz Band"], familyProfileOf), false);
    assert.equal(djRadioSongAllowed(session, radio, ["Unknown"], familyProfileOf), true);
  });

  test("a radio no family brought keeps every song", () => {
    const session = startDjQueue(
      [familyTile("Metal", "Metal Seed"), djArtistTile("Other Artist")!],
      {
        id: "dj-mixed",
      },
    )!;
    assert.equal(
      djRadioSongAllowed(session, "artist:other artist", ["Jazz Band"], familyProfileOf),
      true,
    );
    assert.equal(
      djRadioSongAllowed(session, "artist:metal seed", ["Jazz Band"], familyProfileOf),
      false,
    );
  });

  test("an artist selected on its own keeps an open radio when a family also picks it", () => {
    const session = startDjQueue(
      [familyTile("Metal", "Shared Artist"), djArtistTile("Shared Artist")!],
      {
        id: "dj-artist-and-family",
      },
    )!;
    assert.equal(
      djRadioSongAllowed(session, "artist:shared artist", ["Jazz Band"], familyProfileOf),
      true,
    );
  });

  test("a selected album's artist keeps an open radio when a family also picks it", () => {
    const album = djAlbumTile({ title: "Record", artist: "Shared Artist" })!;
    const session = startDjQueue([familyTile("Metal", "Shared Artist"), album], {
      id: "dj-album-and-family",
    })!;
    assert.equal(
      djRadioSongAllowed(session, "artist:shared artist", ["Jazz Band"], familyProfileOf),
      true,
    );
  });

  test("a family contributes its Genre mix seed artists' radios", () => {
    const artists = [{ id: 1, name: "Rock Artist" }];
    const songs = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      title: `Rock ${index}`,
      artist: "Rock Artist",
      artistIds: [1],
      durationMs: 180_000,
      addedAt: 0,
      genre: "Rock",
    }));
    const family = djGrid({
      artists,
      taste: { ...tasteOf({}), genres: new Map([["rock", 1]]) },
      graph: null,
      genreLibrary: { artists, songs },
    }).find((tile) => tile.kind === "genre");
    assert.ok(family);
    const session = startDjQueue([family], { id: "dj-family" })!;
    assert.deepEqual(
      magicBatchRadios(session, () => 0).seeds.map((seed) => seed.title),
      ["Rock Artist"],
    );
    assert.deepEqual(session.djGenreRadios, [{ id: "artist:rock artist", families: ["rock"] }]);
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(session))), session);
  });

  test("starts with no song played, at DJ's default ranking choices", () => {
    const session = started();
    assert.deepEqual(session.seed, { kind: "dj", id: "dj1", title: "DJ" });
    assert.deepEqual(session.used, []);
    assert.equal(session.batches, 0);
    assert.equal(session.ytShare, 0.6);
    assert.deepEqual(session.dj, DEFAULT_DJ_SETTINGS);
    assert.deepEqual(DEFAULT_DJ_SETTINGS, {
      variety: "medium",
      discovery: "blend",
      popularity: "balanced",
      newReleases: false,
      mood: null,
    });
    assert.equal(session.faithful, undefined);
  });

  test("needs a selected tile", () => {
    assert.equal(startDjQueue([], { id: "dj1" }), null);
  });

  test("each batch reads the radios of up to 3 different selected artists", () => {
    const { session, seeds } = magicBatchRadios(started(), () => 0);
    assert.equal(seeds.length, 3);
    assert.equal(new Set(seeds.map((seed) => seed.artists[0])).size, 3);
    for (const seed of seeds) {
      assert.equal(seed.kind, "artist");
      assert.ok(tiles.some((tile) => tile.name === seed.title && seed.artists[0] === tile.name));
    }
    // The draw is saved with the session: asked again for the same batch, it stands.
    assert.deepEqual(magicBatchRadios(session, () => 0.9).seeds, seeds);
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(session))), session);
  });

  test("the next batch reads the artists the last one left out", () => {
    const first = magicBatchRadios(started(), () => 0);
    const second = magicBatchRadios({ ...first.session, batches: 1 }, () => 0);
    const before = new Set(first.seeds.map((seed) => seed.id));
    const fresh = second.seeds.filter((seed) => !before.has(seed.id));
    assert.equal(second.seeds.length, 3);
    assert.equal(fresh.length, 2);
  });

  test("a single selected artist's radio is every batch's", () => {
    const session = startDjQueue(tiles.slice(0, 1), { id: "dj1" })!;
    const first = magicBatchRadios(session, () => 0);
    assert.deepEqual(
      first.seeds.map((seed) => seed.title),
      ["Artist 0"],
    );
    assert.deepEqual(
      magicBatchRadios({ ...first.session, batches: 1 }, () => 0).seeds.map((seed) => seed.title),
      ["Artist 0"],
    );
  });

  test("the most played selected artists are drawn most often", () => {
    const session = startDjQueue(tiles, {
      id: "dj1",
      played: [{ id: 4, name: "ARTIST 4", countedPlays: 400 }],
    })!;
    let leading = 0;
    for (let draw = 0; draw < 50; draw++) {
      const random = () => (draw + 0.5) / 50;
      if (magicBatchRadios(session, random).seeds[0]!.title === "Artist 4") leading += 1;
    }
    assert.ok(leading > 25, `Artist 4 led ${leading} of 50 draws`);
  });

  test("survives a restart with its seed and its ranking choices", () => {
    const session = started();
    const read = parseMagicSession(JSON.parse(JSON.stringify(session)));
    assert.deepEqual(read, session);
    assert.equal(read!.seed.kind, "dj");
  });

  test("Up Next says it came from DJ", () => {
    assert.equal(magicQueueLabel(started()), "Magic Queue · from DJ");
    assert.equal(magicQueueLabel(started(), catalogueOf("pt-BR")), "Fila Mágica · de DJ");
  });

  test("its first batch is the whole queue: 10 songs, none played before it", () => {
    const candidates = Array.from({ length: 14 }, (_, at) =>
      rankedSong(`v${at}`, `Artist ${at % 5}`),
    );
    const batch = completeMagicRadioBatch(started(), candidates, []);
    assert.equal(batch.trackIds.length, 10);
    assert.equal(batch.trackIds[0], ytTrackId("v0"));
    assert.equal(batch.session.batches, 1);
    assert.equal(completeMagicRadioBatch(batch.session, candidates, []).trackIds.length, 4);
  });

  test("the batch appends nine after a Library song already started", () => {
    const candidates = Array.from({ length: 14 }, (_, at) =>
      rankedSong(`v${at}`, `Artist ${at % 5}`),
    );
    const batch = completeMagicRadioBatch({ ...started(), used: ["42"] }, candidates, []);
    assert.equal(batch.trackIds.length, 9);
    assert.equal(batch.session.batches, 1);
  });

  test("Library and radio starts each complete to ten songs and do not trigger a second batch", () => {
    const radioFirst = ytTrackId("v0");
    const candidates = Array.from({ length: 11 }, (_, at) =>
      rankedSong(`v${at}`, `Artist ${at % 5}`),
    );
    for (const first of ["42", radioFirst]) {
      const batch = completeMagicRadioBatch({ ...started(), used: [first] }, candidates, []);
      assert.equal(batch.trackIds.length, 9);
      const queue = reduceQueue(EMPTY_QUEUE, {
        type: "play",
        trackIds: [first, ...batch.trackIds],
        startIndex: 0,
        context: { kind: MAGIC_QUEUE_CONTEXT, id: batch.session.id },
        shuffle: false,
      }).state;
      assert.equal(queue.entries.length, 10);
      assert.equal(queue.entries[queue.index]?.trackId, first);
      assert.equal(wantsMagicBatch(batch.session, queue), false);
    }
  });

  test("ranks at its own choices, whatever Discover's sliders say", () => {
    const discover = { faithfulness: 1, popularity: 5 } as const;
    assert.deepEqual(magicSessionSliders(started(), discover), { faithfulness: 3, popularity: 3 });
    const ordinary = startStreamedMagicQueue(rankedSong("v1", "Artist 1").song!, { id: "m1" });
    assert.deepEqual(magicSessionSliders(ordinary.session, discover), discover);
  });
});

describe("DJ's grid marks", () => {
  test("an artist the Library doesn't have is new to you; albums and genres never are", () => {
    assert.equal(djNewToYou(djArtistTile("Stranger")!), true);
    assert.equal(djNewToYou(djArtistTile("Known", 7)!), false);
    assert.equal(djNewToYou(djAlbumTile({ title: "Record", artist: "Stranger" })!), false);
    assert.equal(djNewToYou(djGenreTile("Rock")!), false);
  });

  test("the Play pill counts the selection, in both languages", () => {
    const en = catalogueOf("en").dj;
    const pt = catalogueOf("pt-BR").dj;
    assert.deepEqual([en.play, en.playCount(3), en.newToYou], ["Play", "Play · 3", "New to you"]);
    assert.deepEqual(
      [pt.play, pt.playCount(3), pt.newToYou],
      ["Reproduzir", "Reproduzir · 3", "Novo para você"],
    );
  });

  test("the selection row has its heading and its empty line, in both languages", () => {
    const en = catalogueOf("en").dj;
    const pt = catalogueOf("pt-BR").dj;
    assert.deepEqual(
      [en.selection(2), en.selectionEmpty],
      ["Your selection · 2", "Tap artists to start"],
    );
    assert.deepEqual(
      [pt.selection(2), pt.selectionEmpty],
      ["Sua seleção · 2", "Toque em artistas para começar"],
    );
  });
});
