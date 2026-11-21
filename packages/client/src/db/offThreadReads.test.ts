import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";

import { libraryCounts } from "./counts.ts";
import { countTracks, listSongs } from "./libraryQueries.ts";
import {
  NotReplayable,
  readConnections,
  replayRead,
  type AsyncSqlite,
  type ReadConnection,
} from "./offThreadReads.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { selectSongsWithIds } from "./songOrder.ts";
import { addLibrary, asyncReadClient, openTestDatabase } from "./testDatabase.ts";

const library = async () => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: 120, artists: 12, albums: 20 });
  return db;
};

const clock = () => {
  let at = 0;
  return { now: () => at, pass: (ms: number) => (at += ms) };
};

test("a replayed read returns what the synchronous read returns", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  for (const read of [
    listSongs,
    countTracks,
    libraryCounts,
    (d: LibraryDatabase) => d.get<{ n: number }>(sql`SELECT count(*) AS n FROM tracks`),
    (d: LibraryDatabase) => d.transaction((tx) => tx.select().from(schema.tracks).limit(3).all()),
  ] as const) {
    const replayed = await replayRead(reads, read as (d: LibraryDatabase) => unknown, () => 0);
    assert.deepEqual(replayed.value, (read as (d: LibraryDatabase) => unknown)(db));
  }
});

test("a read whose statements depend on earlier rows runs each one off the thread", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  const read = (d: LibraryDatabase) =>
    selectSongsWithIds(
      d,
      listSongs(d)
        .slice(0, 4)
        .map((s) => s.id),
    );
  const replayed = await replayRead(reads, read, () => 0);
  assert.deepEqual(replayed.value, read(db));
  assert.equal(replayed.value.length, 4);
  assert.ok(replayed.statements >= 2);
});

test("the JS time it reports leaves out the wait for SQLite", async () => {
  const db = await library();
  const time = clock();
  const slowSqlite: ReadConnection = {
    snapshot: (inSnapshot) =>
      readConnections(async () => asyncReadClient(db)).snapshot((query) =>
        inSnapshot(async (statement) => {
          time.pass(500);
          return query(statement);
        }),
      ),
  };
  const replayed = await replayRead(
    slowSqlite,
    (d) => {
      time.pass(2);
      return listSongs(d);
    },
    time.now,
  );
  assert.equal(replayed.value.length, 120);
  assert.equal(replayed.heldMs, 4, "two passes of 2 ms; the 500 ms in SQLite isn't held");
});

test("a read that writes or asks about its connection isn't replayed", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  await assert.rejects(
    replayRead(
      reads,
      (d) => d.run(sql`DELETE FROM tracks`),
      () => 0,
    ),
    NotReplayable,
  );
  await assert.rejects(
    replayRead(
      reads,
      (d) => d.get(sql`PRAGMA data_version`),
      () => 0,
    ),
    NotReplayable,
  );
  await assert.rejects(
    replayRead(
      reads,
      (d) => d.get(sql`SELECT changes() AS n`),
      () => 0,
    ),
    NotReplayable,
  );
  assert.equal(countTracks(db), 120, "nothing was deleted");
});

test("a read whose statements keep changing gives up instead of looping", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  let n = 0;
  await assert.rejects(
    replayRead(
      reads,
      (d) => d.get(sql`SELECT ${n++} AS n`),
      () => 0,
    ),
    NotReplayable,
  );
});

test("each read is one transaction on its connection, and a connection runs one at a time", async () => {
  const db = await library();
  const log: string[] = [];
  const opened: string[] = [];
  const reads = readConnections(async () => {
    const name = `c${opened.length}`;
    opened.push(name);
    const inner = asyncReadClient(db);
    const recorded: AsyncSqlite = {
      execAsync: async (statements) => {
        log.push(`${name} ${statements}`);
        return inner.execAsync(statements);
      },
      prepareAsync: async (text) => {
        log.push(`${name} query`);
        return inner.prepareAsync(text);
      },
    };
    return recorded;
  }, 1);
  await Promise.all([
    replayRead(reads, countTracks, () => 0),
    replayRead(reads, countTracks, () => 0),
  ]);
  assert.deepEqual(opened, ["c0"], "opened once, on first use");
  assert.deepEqual(log, ["c0 BEGIN", "c0 query", "c0 COMMIT", "c0 BEGIN", "c0 COMMIT"]);
});

test("a failed read rolls back and frees its connection for the next", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db), 1);
  await assert.rejects(
    replayRead(
      reads,
      (d) => d.get(sql`SELECT * FROM no_such_table`),
      () => 0,
    ),
  );
  assert.equal((await replayRead(reads, countTracks, () => 0)).value, 120);
});
