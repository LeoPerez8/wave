import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addMissingSong,
  addTrack,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "../library/db/testDatabase.ts";
import { randomMagicQueueRead } from "./randomMagicQueueRead.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("a Home opening draws nine never-played files with two local queries and no recommendation inputs", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 12 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    addMissingSong(db, { title: "Missing file" });
    const store = await loadLibraryStore(root, db);
    const read = randomMagicQueueRead(() => 0);
    const measured = traceQueries(db, () => Effect.runSync(read.read(store)));
    assert.deepEqual(
      measured.result.map((song) => song.id),
      ids.slice(0, 9),
    );
    assert.equal(measured.queries.length, 2);
    assert.equal(measured.queries[0]!.rows, 12);
    assert.equal(measured.queries[1]!.rows, 9);
    assert.ok(measured.queries.every((query) => !/play_events|candidate_catalog/.test(query.sql)));
    const reopened = randomMagicQueueRead(() => 0.999);
    assert.deepEqual(
      Effect.runSync(reopened.read(store)).map((song) => song.id),
      [ids[11], ...ids.slice(0, 8)],
    );
    const undo = randomMagicQueueRead(
      () => 0.999,
      measured.result.map((song) => song.id),
    );
    assert.deepEqual(
      Effect.runSync(undo.read(store)).map((song) => song.id),
      ids.slice(0, 9),
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("an empty or small Library needs no loading, taste, or recommendation fallback", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const read = randomMagicQueueRead(() => 0.999);
    assert.deepEqual(Effect.runSync(read.read(store)), []);
    const ids = [addTrack(db, { title: "First song" }), addTrack(db, { title: "Second song" })];
    assert.deepEqual(
      Effect.runSync(read.read(store)).map((song) => song.id),
      ids.toReversed(),
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("a visit keeps its seeds through re-reads, replacing a removed file and filling a growing Library", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 10 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    let draw = 0;
    const read = randomMagicQueueRead(() => draw);
    assert.deepEqual(
      Effect.runSync(read.read(store)).map((song) => song.id),
      ids.slice(0, 9),
    );
    draw = 0.999;
    assert.deepEqual(
      Effect.runSync(read.read(store)).map((song) => song.id),
      ids.slice(0, 9),
    );
    await Effect.runPromise(store.removeSongs([ids[3]!]));
    assert.deepEqual(
      Effect.runSync(read.read(store)).map((song) => song.id),
      [...ids.slice(0, 3), ids[9], ...ids.slice(4, 9)],
    );
    await Effect.runPromise(store.removeSongs(ids.slice(4)));
    assert.deepEqual(
      Effect.runSync(read.read(store)).map((song) => song.id),
      ids.slice(0, 3),
    );
    const added = addTrack(db, { title: "Just scanned" });
    assert.deepEqual(
      Effect.runSync(read.read(store)).map((song) => song.id),
      [...ids.slice(0, 3), added],
    );
  } finally {
    closeTestDatabase(db);
  }
});
