import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  alphabetIndex,
  DEFAULT_SONG_SORT,
  readSongSort,
  SONG_SORTS,
  songSortLabel,
  songSpineKeys,
  sortKey,
  sortSongs,
  writeSongSort,
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
