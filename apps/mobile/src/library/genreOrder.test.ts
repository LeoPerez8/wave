import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SONG_SORTS,
  selectAll,
  selectedInOrder,
  skipMissingSongs,
  songSpineKeys,
  sortSongs,
  spineEntries,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./db/fastAgainFixture.ts";
import { selectGenreOrderSlice } from "./db/genrePages.ts";
import { traceQueries } from "./db/testDatabase.ts";
import { createGenreOrderLoad, readGenreOrder } from "./genreOrder.ts";
import type { SongOrder } from "./LibraryStore.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("a genre's whole order arrives a slice a turn, with every song for Play, Shuffle, Select All and the spine", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const { db, genreId } = fixture;
    const store = await loadLibraryStore(root, db);
    const full = Effect.runSync(store.getGenre(genreId))!.songs;
    // Slices of 40 rather than the store's 500, so 334 songs take several.
    const slices = {
      genreOrderSlice: (
        id: number,
        sort: Parameters<typeof selectGenreOrderSlice>[2],
        cursor: Parameters<typeof selectGenreOrderSlice>[3],
      ) => Effect.sync(() => selectGenreOrderSlice(db, id, sort, cursor, 40)),
    };
    for (const sort of SONG_SORTS) {
      const opening = Effect.runSync(store.openGenre(genreId, sort))!;
      let turns = 0;
      const read = traceQueries(db, () =>
        Effect.runSync(
          readGenreOrder(
            slices,
            genreId,
            sort,
            opening.order,
            Effect.sync(() => void turns++),
          ),
        ),
      );
      const order = read.result;
      const expected = sortSongs(full, sort);
      const label = JSON.stringify(sort);
      assert.deepEqual(
        order.ids,
        expected.map((song) => song.id),
        label,
      );
      assert.deepEqual(order.spine, spineEntries(songSpineKeys(expected, sort) ?? []), label);
      assert.equal(turns, Math.ceil((334 - 50) / 40), label);
      assert.ok(read.queries.every((query) => query.rows <= 40));

      // Play and Shuffle skip the missing songs of the whole genre, not of a page.
      const missing = new Set(order.missing);
      assert.deepEqual(
        skipMissingSongs(order.ids, undefined, (id) => !missing.has(id))!.songs,
        expected.filter((song) => song.path !== null).map((song) => song.id),
      );
      // A row past the first page plays the whole genre from its own place.
      const tapped = order.ids.findIndex((id, index) => index >= 300 && !missing.has(id));
      const play = skipMissingSongs(order.ids, tapped, (id) => !missing.has(id))!;
      assert.equal(play.songs[play.startIndex!], order.ids[tapped]);
      assert.equal(play.songs.length, 334 - missing.size);
      // Select All checks every song; the actions read every one of them.
      const selected = selectedInOrder(selectAll(order.ids, String), order.ids, String);
      assert.deepEqual(
        selected,
        expected.map((song) => song.id),
      );
      assert.equal(Effect.runSync(store.songsWithIds(selected)).length, 334);
    }
  } finally {
    fixture.close();
  }
});

test("a change to the genre mid-read starts its order again, never mixing two orders", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const { db, genreId } = fixture;
    const store = await loadLibraryStore(root, db);
    const sort = SONG_SORTS[0]!;
    const opening = Effect.runSync(store.openGenre(genreId, sort))!;
    const moved = opening.songs[0]!.id;
    let turns = 0;
    const order = Effect.runSync(
      readGenreOrder(
        store,
        genreId,
        sort,
        opening.order,
        Effect.sync(() => {
          // A scan retitles the first song after the opening was read.
          if (turns++ === 0) db.run(sql`UPDATE tracks SET title_sort = 'zzz' WHERE id = ${moved}`);
        }),
      ),
    );
    const expected = sortSongs(Effect.runSync(store.getGenre(genreId))!.songs, sort);
    assert.deepEqual(
      order.ids,
      expected.map((song) => song.id),
    );
    assert.equal(order.ids.at(-1), moved);
    assert.equal(new Set(order.ids).size, 334);
  } finally {
    fixture.close();
  }
});

test("the whole order waits for the screen to settle, unless an action needs it first", async () => {
  const whole: SongOrder = { ids: [1, 2], missing: [], spine: [] };
  let reads = 0;
  let settle!: () => void;
  const settled = Effect.callback<void>((resume) => {
    settle = () => resume(Effect.void);
  });
  const make = () =>
    createGenreOrderLoad({
      read: Effect.sync(() => {
        reads++;
        return whole;
      }),
      settled,
      run: (effect, signal) => Effect.runPromise(effect, { signal }),
    });

  // In the background: nothing until the screen settles.
  const background = make();
  let arrived = 0;
  background.subscribe(() => arrived++);
  background.inBackground();
  background.inBackground();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reads, 0);
  assert.equal(background.current(), null);
  settle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reads, 1);
  assert.equal(arrived, 1);
  assert.equal(background.current(), whole);
  assert.equal(await background.whole(), whole);
  assert.equal(reads, 1);

  // Play pressed first: read at once, once, without waiting for the screen.
  reads = 0;
  const pressed = make();
  pressed.inBackground();
  const [a, b] = await Promise.all([pressed.whole(), pressed.whole()]);
  assert.equal(a, whole);
  assert.equal(b, whole);
  assert.equal(reads, 1);

  // Left before it arrived: what waited gets nothing, and nothing more is read.
  const never = createGenreOrderLoad({
    read: Effect.never,
    settled: Effect.void,
    run: (effect, signal) => Effect.runPromise(effect, { signal }),
  });
  const waiting = never.whole();
  never.dispose();
  assert.equal(await waiting, null);
  assert.equal(await never.whole(), null);
});

test("leaving a genre invalidates even an already cached order", async () => {
  const load = createGenreOrderLoad({
    read: Effect.succeed({ ids: [1], missing: [], spine: [] }),
    settled: Effect.void,
    run: (effect, signal) => Effect.runPromise(effect, { signal }),
  });
  assert.deepEqual((await load.whole())?.ids, [1]);
  load.dispose();
  assert.equal(load.current(), null);
  assert.equal(await load.whole(), null);
});

test("Select All reads complete action rows a page a turn, skipping deleted songs", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const detail = Effect.runSync(store.getGenre(fixture.genreId))!;
    const ids = detail.songs.map((song) => song.id);
    let turns = 0;
    const { readGenreSongs } = await import("./genreOrder.ts");
    const read = traceQueries(fixture.db, () =>
      Effect.runSync(
        readGenreSongs(
          store,
          ids,
          Effect.sync(() => void turns++),
        ),
      ),
    );
    assert.deepEqual(read.result, detail.songs);
    assert.equal(turns, Math.ceil(ids.length / 50));
    assert.ok(read.queries.every((query) => query.rows <= 50));
    assert.deepEqual(Effect.runSync(readGenreSongs(store, [-1], Effect.void)), []);
  } finally {
    fixture.close();
  }
});

test("a late order from a closed genre never publishes, even if its runner ignores abort", async () => {
  const oldOrder: SongOrder = { ids: [99], missing: [], spine: [] };
  let resolve!: (order: SongOrder) => void;
  const load = createGenreOrderLoad({
    read: Effect.succeed(oldOrder),
    settled: Effect.void,
    run: () =>
      new Promise<SongOrder>((answer) => {
        resolve = answer;
      }),
  });
  let published = 0;
  load.subscribe(() => published++);
  const action = load.whole();
  load.dispose();
  resolve(oldOrder);
  assert.equal(await action, null);
  assert.equal(load.current(), null);
  assert.equal(published, 0);
});
