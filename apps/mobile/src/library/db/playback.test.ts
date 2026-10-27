import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE } from "@wave/core";
import { loadPlayback, savePlayback } from "./playback.ts";
import { openTestDatabase, reopenTestDatabase, traceQueries } from "./testDatabase.ts";

const state = { ...EMPTY_QUEUE, entries: [{ key: "1", trackId: "17", contextIndex: 0 }], index: 0 };

test("index and position writes preserve queue entries after reopening SQLite", async () => {
  let db = await openTestDatabase();
  savePlayback(db, { queue: JSON.stringify(state), index: 0, positionMs: 8000 }, 1);
  const { queries } = traceQueries(db, () => savePlayback(db, { index: -1, positionMs: 0 }, 2));
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0]!.sql, /"queue"\s*=/);
  db = await reopenTestDatabase(db);
  const saved = loadPlayback(db)!;
  assert.deepEqual(JSON.parse(saved.queue), { ...state, index: -1 });
  assert.equal(saved.positionMs, 0);
});
