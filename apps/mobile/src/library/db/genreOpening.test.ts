import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { traceQueries } from "./testDatabase.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

test("a 1,000-song Library opens a genre with a narrow header and at most 50 lightweight rows", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const opening = traceQueries(fixture.db, () => Effect.runSync(store.openGenre(fixture.genreId, { key: "title", descending: false })));
    assert.equal(opening.result!.genre.trackCount, 334);
    assert.equal(opening.result!.page.rows.length, 50);
    assert.equal(opening.queries.reduce((n, q) => n + q.rows, 0), 51);
    assert.ok(opening.queries.some(q => q.plan.some(p => /USING.*genre_order_title_asc/.test(p))));
    assert.ok(opening.queries.every(q => q.plan.every(p => !/TEMP B-TREE/.test(p))));
    assert.ok(!("artistIds" in opening.result!.page.rows[0]!.summary));
    const full = Effect.runSync(store.getGenre(fixture.genreId))!;
    assert.deepEqual(opening.result!.page.rows.map(r => r.id), full.songs.slice(0, 50).map(s => s.id));
  } finally { fixture.close(); }
});

test("every genre sort pages through ties with exact full-list equality and indexed seeks", async () => {
  const { SONG_SORTS, sortSongs, songSpineKeys, spineEntries } = await import("@wave/core");
  const { sql } = await import("drizzle-orm");
  const fixture = await createFastAgainFixture();
  try {
    // Force tie groups larger than a page, including null disc/track/path fallbacks.
    fixture.db.run(sql`UPDATE tracks SET title_sort = 'same', added_at = 7,
      disc_number = CASE WHEN id % 2 = 0 THEN NULL ELSE 1 END,
      track_number = CASE WHEN id % 3 = 0 THEN NULL ELSE 2 END`);
    const store = await loadLibraryStore(root, fixture.db);
    const full = Effect.runSync(store.getGenre(fixture.genreId))!.songs;
    for (const sort of SONG_SORTS) {
      const opening = Effect.runSync(store.openGenre(fixture.genreId, sort))!;
      const rows = [...opening.page.rows];
      let cursor = opening.page.next;
      while (cursor !== null) {
        const page = traceQueries(fixture.db, () => Effect.runSync(store.genrePage(fixture.genreId, sort, cursor)));
        assert.equal(page.result.stale, false);
        assert.ok(page.queries.every(q => q.rows <= 50 && !/OFFSET/.test(q.sql)));
        assert.ok(page.queries.filter(q => /FROM genre_order o/.test(q.sql)).every(q => q.plan.some(p => /SEARCH o USING (?:COVERING )?INDEX genre_order_/.test(p)) && q.plan.every(p => !/TEMP B-TREE/.test(p))));
        rows.push(...page.result.rows); cursor = page.result.next;
      }
      const expected = sortSongs(full, sort);
      assert.deepEqual(rows.map(r => r.id), expected.map(r => r.id), JSON.stringify(sort));
      assert.equal(new Set(rows.map(r => r.id)).size, 334);
      assert.deepEqual(spineEntries(rows.map(r => r.letter)), spineEntries(songSpineKeys(expected, sort) ?? expected.map(() => "")));
    }
  } finally { fixture.close(); }
});

test("scan edits and deletions invalidate cursors; artist/album edits update indexed order, and cross-genre/sort cursors are rejected", async () => {
  const { sql } = await import("drizzle-orm");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const sort = { key: "title", descending: false } as const;
    const opening = Effect.runSync(store.openGenre(fixture.genreId, sort))!;
    const cursor = opening.page.next!;
    assert.equal(Effect.runSync(store.genrePage(fixture.genreId + 1, sort, cursor)).stale, true);
    assert.equal(Effect.runSync(store.genrePage(fixture.genreId, { key: "album", descending: false }, cursor)).stale, true);
    fixture.db.run(sql`UPDATE tracks SET title_sort = 'aaa' WHERE id = ${opening.page.rows[49]!.id}`);
    assert.equal(Effect.runSync(store.genrePage(fixture.genreId, sort, cursor)).stale, true);
    const changed = Effect.runSync(store.openGenre(fixture.genreId, sort))!;
    assert.equal(changed.page.rows[0]!.id, opening.page.rows[49]!.id);
    // Move a song to another genre: counts and subsequent snapshots follow the persisted data.
    fixture.db.run(sql`UPDATE tracks SET genre_id = NULL WHERE id = ${changed.page.rows[0]!.id}`);
    assert.equal(Effect.runSync(store.openGenre(fixture.genreId, sort))!.genre.trackCount, 333);
    fixture.db.run(sql`UPDATE artists SET sort = 'aaa' WHERE id = ${fixture.targets.large.artistId}`);
    fixture.db.run(sql`UPDATE albums SET title_sort = 'aaa' WHERE id = ${fixture.albumId}`);
    for (const key of ["artist", "album"] as const) {
      const { sortSongs } = await import("@wave/core");
      const order = { key, descending: false };
      assert.deepEqual(Effect.runSync(store.openGenre(fixture.genreId, order))!.page.rows.map(r => r.id), sortSongs(Effect.runSync(store.getGenre(fixture.genreId))!.songs, order).slice(0, 50).map(s => s.id));
    }
    fixture.db.run(sql`DELETE FROM track_artists WHERE track_id = ${changed.page.rows[1]!.id}`);
    fixture.db.run(sql`DELETE FROM tracks WHERE id = ${changed.page.rows[1]!.id}`);
    assert.equal(Effect.runSync(store.openGenre(fixture.genreId, sort))!.genre.trackCount, 332);
  } finally { fixture.close(); }
});
