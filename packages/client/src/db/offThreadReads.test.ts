import assert from "node:assert/strict";
import { test } from "node:test";
import { inArray, sql } from "drizzle-orm";

import { libraryCounts } from "./counts.ts";
import { countTracks, listSongs } from "./libraryQueries.ts";
import {
  NotReplayable,
  readConnections,
  replayRead,
  runReplayPassesWith,
  yieldReplaysWith,
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

// A decoder that costs [time] 1 ms a value, so a test sees how long mapping held the thread.
const slow = { time: clock(), decoded: 0 };
const slowly = (value: unknown) => {
  slow.time.pass(1);
  slow.decoded++;
  return value;
};
const slowIds = (d: LibraryDatabase, where?: ReturnType<typeof inArray>) =>
  d
    .select({ id: sql<number>`${schema.tracks.id}`.mapWith(slowly), title: schema.tracks.title })
    .from(schema.tracks)
    .where(where)
    .orderBy(schema.tracks.id)
    .all();

/** Runs [run] with each replay step timed on [now], and each yield counted. */
const steps = async <A>(now: () => number, run: () => Promise<A>) => {
  const held: number[] = [];
  let yields = 0;
  runReplayPassesWith((pass) => {
    const start = now();
    try {
      return pass();
    } finally {
      held.push(now() - start);
    }
  });
  yieldReplaysWith(async () => {
    yields++;
  });
  try {
    return { value: await run(), held, yields };
  } finally {
    runReplayPassesWith((pass) => pass());
    yieldReplaysWith(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
};

test("a large result is mapped in short steps that yield between them", async () => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: 600, artists: 12, albums: 20 });
  const reads = readConnections(async () => asyncReadClient(db));
  const expected = slowIds(db);
  slow.time = clock();
  const { value, held, yields } = await steps(slow.time.now, () =>
    replayRead(reads, slowIds, slow.time.now),
  );
  assert.deepEqual(value.value, expected);
  assert.ok(expected.length >= 600);
  assert.ok(Math.max(...held) <= 8, `no step held the thread over 8 ms: ${Math.max(...held)}`);
  assert.ok(yields >= expected.length / 8 - 1, `yielded between steps: ${yields}`);
  assert.equal(value.heldMs, held.reduce((a, b) => a + b, 0));
});

test("each row is mapped once, however many passes the read takes", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  // Each statement depends on the one before: three statements, four passes.
  const read = (d: LibraryDatabase) => {
    const all = slowIds(d);
    const some = slowIds(
      d,
      inArray(
        schema.tracks.id,
        all.slice(0, 60).map((row) => row.id),
      ),
    );
    return slowIds(
      d,
      inArray(
        schema.tracks.id,
        some.slice(0, 30).map((row) => row.id),
      ),
    );
  };
  slow.decoded = 0;
  const expected = read(db);
  const once = slow.decoded;
  slow.decoded = 0;
  const replayed = await replayRead(reads, read, () => 0);
  assert.deepEqual(replayed.value, expected);
  assert.equal(replayed.statements, 3);
  assert.equal(slow.decoded, once, "as many values as the synchronous read decodes");
});

test("a read that sorts or repeats a statement's rows gets its own rows each time", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  const read = (d: LibraryDatabase) => {
    const first = slowIds(d).sort((a, b) => b.id - a.id);
    const again = slowIds(d);
    d.get(sql`SELECT ${first.length} AS n`);
    return { first, again, shared: first.some((row) => again.includes(row)) };
  };
  const replayed = await replayRead(reads, read, () => 0);
  assert.deepEqual(replayed.value, read(db));
  assert.equal(replayed.value.shared, false);
  assert.equal(replayed.value.again[0]!.id < replayed.value.again[1]!.id, true);
});
