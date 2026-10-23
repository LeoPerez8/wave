/** #601: a genre opens on a bounded, indexed first page; its order follows in index seeks. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SONG_SORTS,
  songSpineKeys,
  sortSongs,
  spineEntries,
  type LibrarySongSort,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { selectGenreOrderSlice, type GenreCursor, type GenreOrderSlice } from "./genrePages.ts";
import { selectSongSummaries } from "./songOrder.ts";
import {
  addLibrary,
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
  type TracedQuery,
} from "./testDatabase.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const TITLE: LibrarySongSort = { key: "title", descending: false };

/** Each statement seeks its full sort index, including the file and id ties. */
const assertSeeks = (
  queries: readonly TracedQuery[],
  sort: LibrarySongSort,
  continued = false,
): void => {
  const index = `genre_order_${sort.key}_${sort.descending ? "desc" : "asc"}`;
  // Going on from a cursor seeks past it: a range on the index, not a filter.
  const seek = new RegExp(
    `^SEARCH o USING (COVERING )?INDEX ${index} \\(genre_id=\\?${continued ? " AND " : "\\)"}`,
  );
  for (const query of queries.filter((q) => q.sql.includes("FROM genre_order o"))) {
    assert.ok(
      query.plan.some((step) => seek.test(step)),
      `${index}: ${query.plan.join(" | ")}`,
    );
    assert.ok(
      query.plan.every((step) => !step.includes("TEMP B-TREE")),
      `${index} sorts the genre: ${query.plan.join(" | ")}`,
    );
    if (continued && query.sql.includes(") > (")) {
      assert.ok(
        query.plan.some((step) => /,id\)>/.test(step)),
        `the index must seek through the final ID tie: ${query.plan.join(" | ")}`,
      );
    }
    assert.ok(!/OFFSET/i.test(query.sql));
  }
};

/** The whole order from [first] on, [limit] ids a read. */
const readAll = (
  db: TestDatabase,
  genreId: number,
  sort: LibrarySongSort,
  first: GenreOrderSlice,
  limit: number,
) => {
  const ids = [...first.ids];
  const missing = [...first.missing];
  const letters = [...first.letters];
  const queries: TracedQuery[] = [];
  let next: GenreCursor | null = first.next;
  while (next !== null) {
    const cursor: GenreCursor = next;
    const read = traceQueries(db, () => selectGenreOrderSlice(db, genreId, sort, cursor, limit));
    assert.ok(read.result !== null, "the order didn't change");
    queries.push(...read.queries);
    ids.push(...read.result.ids);
    missing.push(...read.result.missing);
    letters.push(...read.result.letters);
    next = read.result.next;
  }
  return { ids, missing, letters, queries };
};

test("a 1,000-song Library opens a 334-song genre on its header and 50 rows from one index seek", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const full = Effect.runSync(store.getGenre(fixture.genreId))!;
    assert.equal(full.songs.length, 334);
    const opening = traceQueries(fixture.db, () =>
      Effect.runSync(store.openGenre(fixture.genreId, TITLE)),
    );
    const { genre, songs, order } = opening.result!;
    assert.deepEqual(genre, full.genre);
    assert.equal(genre.trackCount, 334);
    // The header's row and the first page: no other SQL row, no full SongRow.
    assert.equal(opening.queries.length, 2);
    assert.equal(
      opening.queries.reduce((sum, query) => sum + query.rows, 0),
      51,
    );
    assertSeeks(opening.queries, TITLE);
    const expected = sortSongs(full.songs, TITLE).slice(0, 50);
    assert.deepEqual(
      songs,
      selectSongSummaries(
        fixture.db,
        expected.map((song) => song.id),
      ),
    );
    assert.deepEqual(
      order.ids,
      expected.map((song) => song.id),
    );
    assert.deepEqual(
      order.missing,
      expected.filter((song) => song.path === null).map((song) => song.id),
    );
    assert.ok(order.next !== null);
    assert.equal(Effect.runSync(store.openGenre(fixture.genreId + 1000, TITLE)), null);
  } finally {
    fixture.close();
  }
});

test("every genre sort pages through runs of ties larger than a page, equal to sortSongs", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const { db, genreId } = fixture;
    // Runs of ties past any page: one title, one added time, missing discs and
    // track numbers; duplicates told apart only by their file, missing ones by their id.
    db.run(sql`UPDATE tracks SET added_at = 7 WHERE id % 2 = 0`);
    db.run(sql`UPDATE tracks SET title_sort = 'same' WHERE id % 5 < 3`);
    db.run(sql`UPDATE tracks SET disc_number = CASE WHEN id % 4 = 0 THEN NULL ELSE 1 END,
      track_number = CASE WHEN id % 3 = 0 THEN NULL ELSE 2 END`);
    db.run(sql`UPDATE tracks SET path = NULL WHERE id % 7 = 0`);
    const store = await loadLibraryStore(root, db);
    const full = Effect.runSync(store.getGenre(genreId))!.songs;
    for (const sort of SONG_SORTS) {
      const expected = sortSongs(full, sort);
      const opening = traceQueries(db, () => Effect.runSync(store.openGenre(genreId, sort)));
      assertSeeks(opening.queries, sort);
      for (const limit of [7, 500]) {
        const all = readAll(db, genreId, sort, opening.result!.order, limit);
        const label = `${JSON.stringify(sort)} in reads of ${limit}`;
        assert.deepEqual(
          all.ids,
          expected.map((song) => song.id),
          label,
        );
        assert.deepEqual(
          all.missing,
          expected.filter((song) => song.path === null).map((song) => song.id),
          label,
        );
        assert.deepEqual(
          spineEntries(all.letters),
          spineEntries(songSpineKeys(expected, sort) ?? []),
          label,
        );
        assertSeeks(all.queries, sort, true);
        assert.ok(all.queries.every((query) => query.rows <= limit));
      }
      // From the start, through the store's own slices.
      const slices = [];
      let cursor: GenreCursor | null = null;
      do {
        const slice: GenreOrderSlice = Effect.runSync(
          store.genreOrderSlice(genreId, sort, cursor),
        )!;
        slices.push(...slice.ids);
        cursor = slice.next;
      } while (cursor !== null);
      assert.deepEqual(
        slices,
        expected.map((song) => song.id),
      );
    }
  } finally {
    fixture.close();
  }
});

test("a change to a genre's order stops its cursors; other genres' changes and other reads don't", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const { db, genreId } = fixture;
    const store = await loadLibraryStore(root, db);
    const open = (sort: LibrarySongSort = TITLE) => Effect.runSync(store.openGenre(genreId, sort))!;
    const slice = (cursor: GenreCursor, sort: LibrarySongSort = TITLE) =>
      Effect.runSync(store.genreOrderSlice(genreId, sort, cursor));
    const expectedIds = (sort: LibrarySongSort) =>
      sortSongs(Effect.runSync(store.getGenre(genreId))!.songs, sort).map((song) => song.id);

    let opening = open();
    const cursor = opening.order.next!;
    // Another genre's or another sort's cursor never reads into this one.
    assert.equal(Effect.runSync(store.genreOrderSlice(genreId + 1, TITLE, cursor)), null);
    assert.equal(slice(cursor, { key: "title", descending: true }), null);
    // A song outside the genre, and a change no order reads, leave the cursor good.
    db.run(sql`UPDATE tracks SET title_sort = 'aaa' WHERE genre_id IS NULL AND id = (
      SELECT min(id) FROM tracks WHERE genre_id IS NULL)`);
    db.run(sql`UPDATE tracks SET duration_ms = duration_ms + 1, scanned_at = 5`);
    db.run(sql`UPDATE tracks SET title_sort = title_sort, path = path`);
    assert.notEqual(slice(cursor), null);

    // Retitled: the cursor stops; reopened, the song leads.
    const moved = opening.songs[49]!.id;
    db.run(sql`UPDATE tracks SET title_sort = '' WHERE id = ${moved}`);
    assert.equal(slice(cursor), null);
    opening = open();
    assert.equal(opening.songs[0]!.id, moved);

    // Gone missing: it stops, and the order reads it as missing.
    const lost = opening.songs[1]!.id;
    db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${lost}`);
    assert.equal(slice(opening.order.next!), null);
    opening = open();
    assert.ok(opening.order.missing.includes(lost));
    assert.equal(opening.songs[1]!.hasFile, false);

    // Moved to no genre, then deleted: counts and orders follow.
    db.run(sql`UPDATE tracks SET genre_id = NULL WHERE id = ${moved}`);
    assert.equal(slice(opening.order.next!), null);
    opening = open();
    assert.equal(opening.genre.trackCount, 333);
    assert.ok(!opening.order.ids.includes(moved));
    const deleted = opening.songs[2]!.id;
    db.run(sql`DELETE FROM track_artists WHERE track_id = ${deleted}`);
    db.run(sql`DELETE FROM tracks WHERE id = ${deleted}`);
    opening = open();
    assert.equal(opening.genre.trackCount, 332);
    assert.ok(!opening.order.ids.includes(deleted));

    // An artist's or an album's sort key moves its songs in those sorts.
    for (const [key, change] of [
      ["artist", sql`UPDATE artists SET sort = '' WHERE id = ${fixture.targets.large.artistId}`],
      [
        "album",
        sql`UPDATE albums SET title_sort = '' WHERE id = ${fixture.targets.large.albumIds[3]!}`,
      ],
    ] as const) {
      const sort = { key, descending: false } as const;
      const before = open(sort).order.next!;
      db.run(change);
      assert.equal(slice(before, sort), null, key);
      const after = open(sort);
      assert.deepEqual(after.order.ids, expectedIds(sort).slice(0, 50), key);
    }
  } finally {
    fixture.close();
  }
});

const readStoredGenreOrder = (db: TestDatabase) =>
  db.all<Record<string, unknown>>(sql`SELECT * FROM genre_order ORDER BY id`);
const expectedStoredGenreOrder = (db: TestDatabase) =>
  db.all<Record<string, unknown>>(sql`SELECT t.id, t.genre_id, t.title_sort,
        a.sort AS artist_sort, b.title_sort AS album_sort, t.album_id,
        coalesce(t.disc_number, 1) AS disc_number,
        coalesce(t.track_number, 9007199254740991) AS track_number, t.added_at,
        coalesce(t.path, '') AS path
      FROM tracks t JOIN artists a ON a.id = t.artist_id JOIN albums b ON b.id = t.album_id
      WHERE t.genre_id IS NOT NULL ORDER BY t.id`);

test("migration 0038 fills the genre order of a Library that shipped without it, and a new one keeps it", async () => {
  // An existing Library: the upgrade fills the order, and the triggers keep it after.
  const old = await openTestDatabase({ through: "0037_recording_titles" });
  addLibrary(old, { tracks: 300, artists: 12, albums: 30 });
  old.run(sql`UPDATE tracks SET disc_number = NULL, track_number = NULL WHERE id % 4 = 0`);
  await migrateTestDatabase(old);
  assert.equal(readStoredGenreOrder(old).length, 100);
  assert.deepEqual(readStoredGenreOrder(old), expectedStoredGenreOrder(old));
  const genreId = old.get<{ id: number }>(sql`SELECT id FROM genres LIMIT 1`).id;
  const store = await loadLibraryStore(root, old);
  const all = (db: TestDatabase) => {
    const first = Effect.runSync(store.openGenre(genreId, TITLE))!;
    return readAll(db, genreId, TITLE, first.order, 500).ids;
  };
  assert.deepEqual(
    all(old),
    sortSongs(Effect.runSync(store.getGenre(genreId))!.songs, TITLE).map((song) => song.id),
  );
  old.run(sql`UPDATE tracks SET title_sort = 'zz' || title_sort WHERE id % 5 = 0`);
  addTrack(old, { title: "Upgraded", artist: "Someone", genre: "Library genre" });
  assert.deepEqual(readStoredGenreOrder(old), expectedStoredGenreOrder(old));

  // A new Library: empty, filled by every write from the first scan on.
  const fresh = await openTestDatabase();
  assert.deepEqual(readStoredGenreOrder(fresh), []);
  assert.deepEqual(fresh.all(sql`SELECT * FROM genre_order_revisions`), []);
  addLibrary(fresh, { tracks: 300, artists: 12, albums: 30 });
  addTrack(fresh, { title: "No genre", artist: "Someone" });
  assert.equal(readStoredGenreOrder(fresh).length, 100);
  assert.deepEqual(readStoredGenreOrder(fresh), expectedStoredGenreOrder(fresh));
  fresh.run(sql`UPDATE artists SET sort = 'a' || sort WHERE id % 2 = 0`);
  fresh.run(sql`UPDATE albums SET title_sort = 'b' || title_sort WHERE id % 3 = 0`);
  fresh.run(sql`UPDATE tracks SET genre_id = NULL WHERE id % 9 = 0`);
  fresh.run(sql`DELETE FROM track_artists WHERE track_id % 11 = 0`);
  fresh.run(sql`DELETE FROM tracks WHERE id % 11 = 0`);
  assert.deepEqual(readStoredGenreOrder(fresh), expectedStoredGenreOrder(fresh));
});

test("even a wholly missing genre of identical names seeks through ID ties without a temporary sort", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const { db, genreId } = fixture;
    const store = await loadLibraryStore(root, db);
    db.run(sql`UPDATE tracks SET title_sort = 'same', artist_id = ${fixture.targets.large.artistId},
      album_id = ${fixture.albumId}, disc_number = NULL, track_number = NULL, added_at = 1, path = NULL
      WHERE genre_id = ${genreId}`);
    const full = Effect.runSync(store.getGenre(genreId))!.songs;
    for (const sort of SONG_SORTS) {
      const first = traceQueries(db, () => Effect.runSync(store.openGenre(genreId, sort))!);
      const all = readAll(db, genreId, sort, first.result.order, 7);
      assert.deepEqual(
        all.ids,
        sortSongs(full, sort).map((song) => song.id),
      );
      for (const query of [...first.queries, ...all.queries]) {
        assert.ok(
          query.plan.every((step) => !step.includes("TEMP B-TREE")),
          query.plan.join(" | "),
        );
      }
    }
  } finally {
    fixture.close();
  }
});
