import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE, queueWrite, reduceQueue, savedQueueState } from "@wave/core";
import { sql } from "drizzle-orm";

import { loadPlayback, savePlayback } from "./playback.ts";
import {
  migrateTestDatabase,
  openTestDatabase,
  reopenTestDatabase,
  traceQueries,
} from "./testDatabase.ts";

const state = reduceQueue(EMPTY_QUEUE, {
  type: "play",
  trackIds: ["1", "2", "3"],
  context: { kind: "songs", id: null },
}).state;

test("a skip writes the index and position, and the queue reads back moved on", async () => {
  let db = await openTestDatabase();
  savePlayback(db, queueWrite(null, { state, positionMs: 83_000 }), 1);
  const skipped = reduceQueue(state, { type: "next" }).state;
  const write = queueWrite({ state, positionMs: 83_000 }, { state: skipped, positionMs: 0 });
  const { queries } = traceQueries(db, () => savePlayback(db, write, 2));
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0]!.sql, /"queue"\s*=/);
  db = await reopenTestDatabase(db);
  const saved = loadPlayback(db)!;
  assert.deepEqual(savedQueueState(saved.parts), skipped);
  assert.equal(saved.positionMs, 0);
});

test("a new queue replaces the parts saved apart", async () => {
  const db = await openTestDatabase();
  const repeated = reduceQueue(state, { type: "setRepeat", mode: "all" }).state;
  savePlayback(db, queueWrite(null, { state, positionMs: 0 }), 1);
  savePlayback(db, queueWrite({ state, positionMs: 0 }, { state: repeated, positionMs: 0 }), 2);
  const added = reduceQueue(repeated, { type: "addToQueue", trackIds: ["4"] }).state;
  savePlayback(
    db,
    queueWrite({ state: repeated, positionMs: 0 }, { state: added, positionMs: 0 }),
    3,
  );
  assert.deepEqual(savedQueueState(loadPlayback(db)!.parts), added);
});

test("nothing to write runs no statement", async () => {
  const db = await openTestDatabase();
  const { queries } = traceQueries(db, () => savePlayback(db, {}, 1));
  assert.equal(queries.length, 0);
});

test("a queue an earlier Wave saved whole still resumes", async () => {
  const db = await openTestDatabase({ through: "0042_streamed_counts" });
  db.run(
    sql`INSERT INTO playback_state (id, queue, position_ms, updated_at) VALUES (1, ${JSON.stringify(state)}, 4200, 1)`,
  );
  await migrateTestDatabase(db);
  const saved = loadPlayback(db)!;
  assert.deepEqual(saved.parts, { queue: JSON.stringify(state), metadata: null, index: null });
  assert.deepEqual(savedQueueState(saved.parts), state);
  assert.equal(saved.positionMs, 4200);
});
