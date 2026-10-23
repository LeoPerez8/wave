import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { SONG_SORTS, sortSongs, skipMissingSongs, selectAll, selectedInOrder, songSpineKeys, spineEntries } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./db/fastAgainFixture.ts";
import { traceQueries } from "./db/testDatabase.ts";
import { readGenreOrder } from "./genreOrder.ts";
const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("the deferred genre order yields per page and retains complete playback, Select All and A–Z context", async () => {
 const f = await createFastAgainFixture();
 try {
  const store = await loadLibraryStore(root, f.db);
  const full = Effect.runSync(store.getGenre(f.genreId))!.songs;
  for (const sort of SONG_SORTS) {
   const opening = Effect.runSync(store.openGenre(f.genreId, sort))!;
   let turns = 0;
   const result = traceQueries(f.db, () => Effect.runSync(readGenreOrder(store, opening, sort, Effect.sync(() => { turns++; }))));
   const order = result.result!;
   const expected = sortSongs(full, sort);
   assert.deepEqual(order.ids, expected.map(r => r.id));
   assert.deepEqual(order.spine, spineEntries(songSpineKeys(expected, sort) ?? []));
   assert.ok(turns >= 6);
   assert.ok(result.queries.every(q => q.rows <= 50));
   const missing = new Set(order.missing);
   assert.deepEqual(skipMissingSongs(order.ids, 120, id => !missing.has(id))!.songs, expected.filter(s => s.path !== null).map(s => s.id));
   const selected = selectedInOrder(selectAll(order.ids, String), order.ids, String);
   assert.deepEqual(selected, expected.map(s => s.id));
   assert.equal(Effect.runSync(store.songsWithIds(selected)).length, 334);
  }
 } finally { f.close(); }
});

test("a mutation between order slices discards every partial id instead of mixing snapshots", async () => {
 const { sql } = await import("drizzle-orm");
 const f = await createFastAgainFixture();
 try {
  const store = await loadLibraryStore(root, f.db);
  const sort = SONG_SORTS[0]!;
  const opening = Effect.runSync(store.openGenre(f.genreId, sort))!;
  const result = Effect.runSync(readGenreOrder(store, opening, sort, Effect.sync(() => {
    f.db.run(sql`UPDATE tracks SET title_sort = 'changed' WHERE id = ${opening.page.rows[0]!.id}`);
  })));
  assert.equal(result, null);
 } finally { f.close(); }
});
