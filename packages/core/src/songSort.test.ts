import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  alphabetIndex,
  DEFAULT_SONG_SORT,
  defaultSongSort,
  librarySongSort,
  readSongSort,
  sameSongSort,
  SONG_SORTS,
  songSortsFor,
  songSortLabel,
  songSpineKeys,
  sortKey,
  sortSongs,
  writeSongSort,
  type SongListKind,
  type SongSort,
  type SortableSong,
} from "./index.ts";

/** A song with only what the test cares about; the rest is filler. */
const song = (
  name: string,
  fields: Partial<{
    title: string;
    artist: string;
    album: string;
    albumId: number;
    disc: number | null;
    track: number | null;
    addedAt: number;
  }> = {},
): SortableSong & { readonly name: string } => ({
  name,
  titleSort: sortKey(fields.title ?? name),
  artistSort: sortKey(fields.artist ?? "Artist"),
  albumSort: sortKey(fields.album ?? "Album"),
  albumId: fields.albumId ?? 1,
  discNumber: fields.disc ?? null,
  trackNumber: fields.track ?? null,
  addedAt: fields.addedAt ?? 0,
  path: `/music/${name}.mp3`,
});

const names = (songs: readonly { readonly name: string }[]): string[] => songs.map((s) => s.name);

describe("sortSongs by song name", () => {
  test("orders by title, ignoring articles and accents", () => {
    const songs = [song("Écho"), song("The Beat"), song("Alone")];
    assert.deepEqual(names(sortSongs(songs, { key: "title", descending: false })), [
      "Alone",
      "The Beat",
      "Écho",
    ]);
  });

  test("breaks ties by artist", () => {
    const songs = [
      song("Intro by Muse", { title: "Intro", artist: "Muse" }),
      song("Intro by The xx", { title: "Intro", artist: "The xx" }),
      song("Intro by Alt-J", { title: "Intro", artist: "Alt-J" }),
    ];
    assert.deepEqual(names(sortSongs(songs, { key: "title", descending: false })), [
      "Intro by Alt-J",
      "Intro by Muse",
      "Intro by The xx",
    ]);
  });

  test("descending runs Z to A but keeps ties by artist A to Z", () => {
    const songs = [
      song("Intro by Muse", { title: "Intro", artist: "Muse" }),
      song("Zebra"),
      song("Intro by Alt-J", { title: "Intro", artist: "Alt-J" }),
      song("Alone"),
    ];
    assert.deepEqual(names(sortSongs(songs, { key: "title", descending: true })), [
      "Zebra",
      "Intro by Alt-J",
      "Intro by Muse",
      "Alone",
    ]);
  });
});

describe("sortSongs by artist", () => {
  const songs = [
    song("Yellow", { artist: "Coldplay", album: "Parachutes", albumId: 2, track: 5 }),
    song("Clocks", { artist: "Coldplay", album: "A Rush of Blood", albumId: 3, track: 5 }),
    song("Get Lucky", { artist: "Daft Punk", album: "Random Access", albumId: 4, track: 8 }),
    song("Shiver", { artist: "Coldplay", album: "Parachutes", albumId: 2, track: 2 }),
    song("Ágape", { artist: "The Ágape", album: "One", albumId: 5, track: 1 }),
    song("Politik", { artist: "Coldplay", album: "A Rush of Blood", albumId: 3, track: 1 }),
  ];

  test("orders by artist ignoring articles and accents, then album (articles ignored too), then track", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "artist", descending: false })), [
      "Ágape",
      "Shiver",
      "Yellow",
      "Politik",
      "Clocks",
      "Get Lucky",
    ]);
  });

  test("descending reverses the artists only: albums and tracks keep their order", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "artist", descending: true })), [
      "Get Lucky",
      "Shiver",
      "Yellow",
      "Politik",
      "Clocks",
      "Ágape",
    ]);
  });

  test("an artist's tracks run disc by disc", () => {
    const discs = [
      song("Two-1", { album: "Double", disc: 2, track: 1 }),
      song("One-2", { album: "Double", disc: 1, track: 2 }),
      song("One-1", { album: "Double", disc: 1, track: 1 }),
    ];
    assert.deepEqual(names(sortSongs(discs, { key: "artist", descending: false })), [
      "One-1",
      "One-2",
      "Two-1",
    ]);
  });
});

describe("sortSongs by album", () => {
  const songs = [
    song("Teardrop", { album: "Mezzanine", albumId: 1, track: 3 }),
    song("Zulu 2", { album: "The Zulu Sessions", albumId: 2, disc: 1, track: 2 }),
    song("Angel", { album: "Mezzanine", albumId: 1, track: 1 }),
    song("Zulu 3", { album: "The Zulu Sessions", albumId: 2, disc: 2, track: 1 }),
    song("Zulu 1", { album: "The Zulu Sessions", albumId: 2, disc: 1, track: 1 }),
    song("Ádios", { album: "Ádios", albumId: 3, track: 1 }),
  ];

  test("orders by album title ignoring articles and accents, then disc and track", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "album", descending: false })), [
      "Ádios",
      "Angel",
      "Teardrop",
      "Zulu 1",
      "Zulu 2",
      "Zulu 3",
    ]);
  });

  test("descending runs albums Z to A, each album's tracks still 1, 2, 3", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "album", descending: true })), [
      "Zulu 1",
      "Zulu 2",
      "Zulu 3",
      "Angel",
      "Teardrop",
      "Ádios",
    ]);
  });

  test("keeps two albums sharing a title apart", () => {
    const hits = [
      song("Queen 2", { album: "Greatest Hits", albumId: 7, track: 2 }),
      song("ABBA 1", { album: "Greatest Hits", albumId: 4, track: 1 }),
      song("Queen 1", { album: "Greatest Hits", albumId: 7, track: 1 }),
      song("ABBA 2", { album: "Greatest Hits", albumId: 4, track: 2 }),
    ];
    assert.deepEqual(names(sortSongs(hits, { key: "album", descending: false })), [
      "ABBA 1",
      "ABBA 2",
      "Queen 1",
      "Queen 2",
    ]);
  });
});

describe("songSpineKeys", () => {
  const songs = [
    song("Wonderwall", { artist: "Oasis", album: "Morning Glory" }),
    song("Airbag", { artist: "Radiohead", album: "OK Computer" }),
    song("Karma Police", { artist: "Radiohead", album: "The Bends" }),
  ];
  const letters = (sort: SongSort): string[] | undefined => {
    const keys = songSpineKeys(sortSongs(songs, sort), sort);
    return keys === undefined ? undefined : alphabetIndex(keys).map((entry) => entry.letter);
  };

  test("files songs under their song name, artist or album initials", () => {
    assert.deepEqual(letters({ key: "title", descending: false }), ["A", "K", "W"]);
    assert.deepEqual(letters({ key: "artist", descending: false }), ["O", "R"]);
    assert.deepEqual(letters({ key: "album", descending: false }), ["B", "M", "O"]);
  });

  test("runs Z at the top when descending", () => {
    assert.deepEqual(letters({ key: "title", descending: true }), ["W", "K", "A"]);
    assert.deepEqual(letters({ key: "artist", descending: true }), ["R", "O"]);
  });

  test("has no spine for date added", () => {
    assert.equal(letters({ key: "added", descending: true }), undefined);
  });
});

describe("song sort choices", () => {
  test("offers each sort both ways, the newest first for date added", () => {
    assert.deepEqual(SONG_SORTS.map(songSortLabel), [
      "Song name, A to Z",
      "Song name, Z to A",
      "Artist, A to Z",
      "Artist, Z to A",
      "Album, A to Z",
      "Album, Z to A",
      "Date added, newest first",
      "Date added, oldest first",
    ]);
  });

  test("defaults to song name A to Z", () => {
    assert.deepEqual(DEFAULT_SONG_SORT, { key: "title", descending: false });
  });

  test("a saved sort reads back as itself", () => {
    for (const sort of SONG_SORTS) assert.deepEqual(readSongSort(writeSongSort(sort)), sort);
  });

  test("nothing saved, or something unreadable, reads as the default", () => {
    assert.deepEqual(readSongSort(null), DEFAULT_SONG_SORT);
    assert.deepEqual(readSongSort("shuffle"), DEFAULT_SONG_SORT);
    assert.deepEqual(readSongSort("{}"), DEFAULT_SONG_SORT);
    assert.deepEqual(readSongSort('{"key":"genre","descending":true}'), DEFAULT_SONG_SORT);
  });
});

describe("sortSongs by date added", () => {
  const songs = [
    song("Old", { addedAt: 1_000 }),
    song("New", { addedAt: 3_000 }),
    song("Same time B", { addedAt: 2_000 }),
    song("Same time A", { addedAt: 2_000 }),
  ];

  test("newest first when descending, ties by song name", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "added", descending: true })), [
      "New",
      "Same time A",
      "Same time B",
      "Old",
    ]);
  });

  test("oldest first when ascending, ties by song name", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "added", descending: false })), [
      "Old",
      "Same time A",
      "Same time B",
      "New",
    ]);
  });
});

const starred = (name: string, starredAt: number) => ({ ...song(name), starredAt });

describe("sortSongs by date starred", () => {
  const songs = [
    starred("Early", 1_000),
    starred("Late", 3_000),
    starred("Same time B", 2_000),
    starred("Same time A", 2_000),
  ];

  test("most recently starred first when descending, ties by song name", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "starred", descending: true })), [
      "Late",
      "Same time A",
      "Same time B",
      "Early",
    ]);
  });

  test("oldest first when ascending", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "starred", descending: false })), [
      "Early",
      "Same time A",
      "Same time B",
      "Late",
    ]);
  });

  test("has no spine", () => {
    assert.equal(songSpineKeys(songs, { key: "starred", descending: true }), undefined);
  });
});

describe("sortSongs by popularity", () => {
  const ranked = (name: string, popularRank: number | undefined) => ({
    ...song(name),
    popularRank,
  });
  const songs = [
    ranked("Unlisted B", undefined),
    ranked("Second", 2),
    ranked("Unlisted A", undefined),
    ranked("First", 1),
  ];

  test("the list's order first, the songs it doesn't hold after them in song name order", () => {
    assert.deepEqual(names(sortSongs(songs, { key: "popular", descending: false })), [
      "First",
      "Second",
      "Unlisted A",
      "Unlisted B",
    ]);
  });

  test("has no spine", () => {
    assert.equal(songSpineKeys(songs, { key: "popular", descending: false }), undefined);
  });

  test("its label reads the name alone", () => {
    assert.equal(songSortLabel({ key: "popular", descending: false }), "Popular");
  });

  test("the Library's tables can't order by it: song name A to Z stands in", () => {
    assert.deepEqual(librarySongSort({ key: "popular", descending: false }), DEFAULT_SONG_SORT);
  });
});

const labels = (kind: SongListKind) => songSortsFor(kind).map(songSortLabel);

const KINDS: readonly SongListKind[] = ["songs", "artist", "genre", "favorites"];

describe("sorts per kind of song list", () => {
  const shared = SONG_SORTS.map(songSortLabel);

  test("Songs and genre lists offer the shared sorts, song name A to Z first", () => {
    for (const kind of ["songs", "genre"] as const) {
      assert.deepEqual(labels(kind), shared);
      assert.deepEqual(defaultSongSort(kind), { key: "title", descending: false });
    }
  });

  test("an artist's songs lead with Popular, the default, then the shared sorts", () => {
    assert.deepEqual(labels("artist"), ["Popular", ...shared]);
    assert.deepEqual(defaultSongSort("artist"), { key: "popular", descending: false });
  });

  test("Favorites leads with date starred, and defaults to most recently starred", () => {
    assert.deepEqual(labels("favorites"), [
      "Date starred, newest first",
      "Date starred, oldest first",
      ...shared,
    ]);
    assert.deepEqual(defaultSongSort("favorites"), { key: "starred", descending: true });
  });

  test("a saved sort reads back as itself for every kind", () => {
    for (const kind of KINDS)
      for (const sort of songSortsFor(kind))
        assert.deepEqual(readSongSort(writeSongSort(sort), kind), sort);
  });

  test("nothing saved reads as the kind's default", () => {
    for (const kind of KINDS) assert.deepEqual(readSongSort(null, kind), defaultSongSort(kind));
  });

  test("a sort the kind doesn't offer reads as its default", () => {
    assert.deepEqual(
      readSongSort(writeSongSort({ key: "starred", descending: false }), "artist"),
      defaultSongSort("artist"),
    );
    assert.deepEqual(
      readSongSort(writeSongSort({ key: "popular", descending: false }), "songs"),
      DEFAULT_SONG_SORT,
    );
    assert.deepEqual(
      readSongSort(writeSongSort({ key: "popular", descending: false }), "favorites"),
      defaultSongSort("favorites"),
    );
    // The file-name order Library › Folders had, saved before Folders went.
    assert.deepEqual(readSongSort('{"key":"file","descending":false}', "songs"), DEFAULT_SONG_SORT);
  });
});

describe("sameSongSort", () => {
  test("the same key in the same direction is the same sort", () => {
    assert.equal(sameSongSort({ key: "title", descending: false }, DEFAULT_SONG_SORT), true);
    assert.equal(
      sameSongSort({ key: "title", descending: true }, { key: "title", descending: false }),
      false,
    );
    assert.equal(
      sameSongSort({ key: "artist", descending: false }, { key: "album", descending: false }),
      false,
    );
  });
});

describe("song sorts in Portuguese", () => {
  test("a sort reads its name and direction", async () => {
    const { songSortLabelFor } = await import("./index.ts");
    const label = songSortLabelFor("pt-BR");
    assert.equal(label({ key: "title", descending: false }), "Nome da música, A a Z");
    assert.equal(label({ key: "artist", descending: true }), "Artista, Z a A");
    assert.equal(
      label({ key: "added", descending: true }),
      "Data de adição, mais recentes primeiro",
    );
    assert.equal(label({ key: "popular", descending: false }), "Populares");
  });
});
