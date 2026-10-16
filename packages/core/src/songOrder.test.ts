import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SONG_SORT,
  librarySongSort,
  SONG_SORTS,
  songOrderTerms,
  sortKey,
  sortSongs,
  type SongOrderTerm,
  type SortableSong,
} from "./index.ts";

type Song = SortableSong & { readonly id: number };

/**
 * How SQLite's ORDER BY reads [terms]: each term's value (a null standing in
 * as `nullAs`), compared as numbers or by code point, reversed when descending.
 * This is the model the database query is built against, not Core's comparators.
 */
const orderBy =
  (terms: readonly SongOrderTerm[]) =>
  (a: Song, b: Song): number => {
    for (const { field, descending, nullAs } of terms) {
      const x = a[field] ?? nullAs ?? null;
      const y = b[field] ?? nullAs ?? null;
      if (x === y) continue;
      if (x === null) return descending ? 1 : -1;
      if (y === null) return descending ? -1 : 1;
      const less = x < y;
      return (less ? -1 : 1) * (descending ? -1 : 1);
    }
    return 0;
  };

/** A Library with every tie the sorts break: shared titles, albums, discs, missing songs. */
const library = (): Song[] => {
  const titles = ["Intro", "The Beat", "Écho", "alone", "Alone", "123", "Zebra"];
  const artists = ["Muse", "The Cure", "ABBA", "Ásgeir"];
  const albums = ["Origin", "Disintegration", "Gold"];
  const songs: Song[] = [];
  let id = 1;
  for (let i = 0; i < 160; i++) {
    const title = titles[(i * 7) % titles.length]!;
    const artist = artists[(i * 3) % artists.length]!;
    const album = albums[(i * 5) % albums.length]!;
    songs.push({
      id: id++,
      titleSort: sortKey(title),
      artistSort: sortKey(artist),
      albumSort: sortKey(album),
      // Two albums share a title (ids 1 and 4 are both "Origin").
      albumId: ((i * 5) % albums.length) + (i % 2 === 0 ? 1 : 4),
      discNumber: i % 5 === 0 ? null : (i % 2) + 1,
      trackNumber: i % 7 === 0 ? null : (i % 4) + 1,
      addedAt: (i % 9) * 1_000,
      // Every eleventh song is missing (no file): ties among them fall to the id.
      path: i % 11 === 0 ? null : `/music/${String(i % 13).padStart(2, "0")}-${i}.mp3`,
    });
  }
  return songs;
};

describe("songOrderTerms", () => {
  test("ordering the Library by them gives the order sortSongs gives, for every Songs sort", () => {
    // In id order, as sortSongs keeps full ties in the order it was given them.
    const songs = library();
    for (const sort of SONG_SORTS) {
      const expected = sortSongs(songs, sort).map((song) => song.id);
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
      const actual = [...songs].reverse().sort(orderBy(songOrderTerms(sort)));
      assert.deepEqual(
        actual.map((song) => song.id),
        expected,
        `${sort.key} ${sort.descending ? "descending" : "ascending"}`,
      );
    }
  });

  test("end on the id, so songs alike in every sorted field keep one order", () => {
    for (const sort of SONG_SORTS) {
      assert.deepEqual(songOrderTerms(sort).at(-1), { field: "id", descending: false });
    }
  });
});

describe("librarySongSort", () => {
  test("keeps a sort the Library's tables can order by", () => {
    const sort = { key: "album", descending: true } as const;
    assert.deepEqual(librarySongSort(sort), sort);
  });

  test("falls back to song name A to Z for date starred, which only Favorites have", () => {
    assert.deepEqual(librarySongSort({ key: "starred", descending: true }), DEFAULT_SONG_SORT);
  });
});
