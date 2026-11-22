import assert from "node:assert/strict";
import { test } from "node:test";
import { inArray, sql } from "drizzle-orm";

import { libraryCounts } from "./counts.ts";
import { countTracks, listSongs } from "./libraryQueries.ts";
import {
  decodedRows,
  finishReplaySteps,
  NotReplayable,
  readConnections,
  replayRead,
  runReplayPassesWith,
  sharedReplays,
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
const slowly = (value: unknown): number => {
  slow.time.pass(1);
  slow.decoded++;
  return value as number;
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
  assert.equal(
    value.heldMs,
    held.reduce((a, b) => a + b, 0),
  );
});

test("work in steps runs in slices of a replay step at most, yielding between them", async () => {
  const time = clock();
  function* counted(steps: number): Generator<void, number> {
    for (let step = 0; step < steps; step++) {
      time.pass(1);
      yield;
    }
    return steps;
  }
  const { value, held, yields } = await steps(time.now, () =>
    finishReplaySteps(counted(100), time.now),
  );
  assert.equal(value.value, 100);
  assert.ok(Math.max(...held) <= 8, `no slice held the thread over 8 ms: ${Math.max(...held)}`);
  assert.equal(held.length, yields + 1, "a yield between each two slices");
  assert.ok(yields >= 100 / 8 - 1, `yielded between slices: ${yields}`);
  assert.equal(
    value.heldMs,
    held.reduce((a, b) => a + b, 0),
  );
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

/** [db]'s read connection, with every statement it runs counted by its SQL and params. */
const countedReads = (db: Awaited<ReturnType<typeof library>>) => {
  const inner = readConnections(async () => asyncReadClient(db));
  const ran = new Map<string, number>();
  const connection: ReadConnection = {
    snapshot: (inSnapshot) =>
      inner.snapshot((query) =>
        inSnapshot((statement) => {
          const key = `${statement.sql} ${JSON.stringify(statement.params)}`;
          ran.set(key, (ran.get(key) ?? 0) + 1);
          return query(statement);
        }),
      ),
  };
  return { connection, ran, total: () => [...ran.values()].reduce((a, b) => a + b, 0) };
};

/** [read] with the passes that run it counted. */
const passesOf = <A>(read: (d: LibraryDatabase) => A) => {
  const counter = {
    passes: 0,
    read: (d: LibraryDatabase): A => {
      counter.passes++;
      return read(d);
    },
  };
  return counter;
};

// Three statements, each from the rows of the one before.
const chained = (d: LibraryDatabase) => {
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

test("a read with k statements that ran before runs each statement once, in one pass", async () => {
  const db = await library();
  const { connection, ran, total } = countedReads(db);
  const counted = passesOf(chained);
  const first = await replayRead(connection, counted.read, () => 0);
  assert.equal(first.statements, 3);
  assert.equal(counted.passes, 4, "the first time: a pass for each statement, and the last");
  counted.passes = 0;
  ran.clear();
  slow.decoded = 0;
  const again = await replayRead(connection, counted.read, () => 0);
  assert.deepEqual(again.value, chained(db));
  assert.equal(counted.passes, 1, "the statements it ran last time are fetched first");
  assert.equal(again.statements, 3);
  assert.equal(total(), 3, "each statement goes to SQLite once");
  assert.ok([...ran.values()].every((times) => times === 1));
});

test("a read whose rows changed since it last ran asks for its new statements", async () => {
  const db = await library();
  const { connection } = countedReads(db);
  const read = (d: LibraryDatabase) => chained(d);
  await replayRead(connection, read, () => 0);
  db.delete(schema.tracks)
    .where(
      inArray(
        schema.tracks.id,
        slowIds(db)
          .slice(0, 10)
          .map((row) => row.id),
      ),
    )
    .run();
  const again = await replayRead(connection, read, () => 0);
  assert.deepEqual(again.value, chained(db));
  assert.equal(again.statements, 3, "only the statements this run asked for count");
});

test("a statement that changes on every run stops being fetched ahead", async () => {
  const db = await library();
  const { connection, total } = countedReads(db);
  let run = 0;
  const read = (d: LibraryDatabase) => [countTracks(d), d.get(sql`SELECT ${run} AS n`)];
  const statements: number[] = [];
  for (; run < 4; run++) {
    const before = total();
    await replayRead(connection, read, () => 0);
    statements.push(total() - before);
  }
  // The second run fetches the first run's two ahead, one of them for nothing; from the
  // third on, only the statement both runs before it asked for.
  assert.deepEqual(statements, [2, 3, 2, 2]);
});

test("a large result fetched ahead is mapped in short steps before the pass", async () => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: 600, artists: 12, albums: 20 });
  const reads = readConnections(async () => asyncReadClient(db));
  const expected = slowIds(db);
  const counted = passesOf((d: LibraryDatabase) => slowIds(d));
  await replayRead(reads, counted.read, () => 0);
  counted.passes = 0;
  slow.time = clock();
  const { value, held } = await steps(slow.time.now, () =>
    replayRead(reads, counted.read, slow.time.now),
  );
  assert.deepEqual(value.value, expected);
  assert.equal(counted.passes, 1);
  assert.ok(Math.max(...held) <= 8, `no step held the thread over 8 ms: ${Math.max(...held)}`);
});

// A raw statement's row decoder that costs [slow]'s time 1 ms a row, as a JSON column does.
const slowRow = (row: { id: number; title: string }) => {
  slow.time.pass(1);
  slow.decoded++;
  return { id: row.id, name: row.title.toUpperCase() };
};
const decodedIds = (d: LibraryDatabase, below = 1e9) =>
  decodedRows(d, sql`SELECT id, title FROM tracks WHERE id < ${below} ORDER BY id`, slowRow);

test("a raw statement's rows decode in short steps, once however many passes the read takes", async () => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: 600, artists: 12, albums: 20 });
  const reads = readConnections(async () => asyncReadClient(db));
  // Two statements, the second from the first's rows: at least three passes.
  const read = (d: LibraryDatabase) => {
    const all = decodedIds(d);
    return { all, some: decodedIds(d, all[300]!.id) };
  };
  slow.decoded = 0;
  const expected = read(db);
  const once = slow.decoded;
  slow.decoded = 0;
  slow.time = clock();
  const { value, held } = await steps(slow.time.now, () => replayRead(reads, read, slow.time.now));
  assert.deepEqual(value.value, expected);
  assert.equal(value.statements, 2);
  assert.equal(slow.decoded, once, "as many rows as the synchronous read decodes");
  assert.ok(Math.max(...held) <= 8, `no step held the thread over 8 ms: ${Math.max(...held)}`);
});

test("a raw statement's rows decoded last time are decoded ahead, in short steps", async () => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: 600, artists: 12, albums: 20 });
  const reads = readConnections(async () => asyncReadClient(db));
  const expected = decodedIds(db);
  const counted = passesOf((d: LibraryDatabase) => decodedIds(d));
  await replayRead(reads, counted.read, () => 0);
  counted.passes = 0;
  slow.time = clock();
  const { value, held } = await steps(slow.time.now, () =>
    replayRead(reads, counted.read, slow.time.now),
  );
  assert.deepEqual(value.value, expected);
  assert.equal(counted.passes, 1);
  assert.ok(Math.max(...held) <= 8, `no step held the thread over 8 ms: ${Math.max(...held)}`);
});

test("a read decoding a raw statement two ways gets each way's values", async () => {
  const db = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  const titles = (row: { id: number; title: string }) => row.title;
  const read = (d: LibraryDatabase) => ({
    decoded: decodedIds(d),
    titles: decodedRows(d, sql`SELECT id, title FROM tracks WHERE id < ${1e9} ORDER BY id`, titles),
    raw: d.all(sql`SELECT id, title FROM tracks WHERE id < ${1e9} ORDER BY id`),
  });
  assert.deepEqual((await replayRead(reads, read, () => 0)).value, read(db));
});

test("a slice of a read's working out runs under the name its caller gives", async () => {
  const names: (string | undefined)[] = [];
  runReplayPassesWith((pass, name) => {
    names.push(name);
    return pass();
  });
  try {
    function* two(): Generator<void, number> {
      yield;
      return 2;
    }
    await finishReplaySteps(two(), () => 0, "play totals fallback");
    await finishReplaySteps(two(), () => 0);
  } finally {
    runReplayPassesWith((pass) => pass());
  }
  assert.deepEqual(names, ["play totals fallback", undefined]);
});

test("two callers asking for the same read at once share it", async () => {
  const db = await library();
  const { connection, total } = countedReads(db);
  const time = clock();
  const replays = sharedReplays(connection, time.now);
  const counted = passesOf((d: LibraryDatabase) => {
    time.pass(1);
    return chained(d);
  });
  const [a, b] = await Promise.all([replays(counted.read), replays(counted.read)]);
  assert.deepEqual(a.value, chained(db));
  assert.deepEqual(b.value, a.value);
  assert.notEqual(a.value, b.value, "each caller gets its own array");
  assert.equal(counted.passes, 4, "one replay");
  assert.equal(total(), 3);
  assert.deepEqual([a.heldMs, b.heldMs], [4, 0], "only the caller whose replay ran held JS");
  // Once it's done, the next ask replays it again.
  await replays(counted.read);
  assert.equal(counted.passes, 5);
});

test("a write before the shared read begins reading is in every caller's result", async () => {
  const db = await library();
  const { connection } = countedReads(db);
  const time = clock();
  const replays = sharedReplays(connection, time.now);
  const read = (d: LibraryDatabase) => {
    time.pass(1);
    return countTracks(d);
  };
  const first = replays(read);
  db.delete(schema.tracks)
    .where(
      inArray(
        schema.tracks.id,
        slowIds(db)
          .slice(0, 10)
          .map((row) => row.id),
      ),
    )
    .run();
  const second = await replays(read);
  assert.deepEqual([(await first).value, second.value], [110, 110]);
  assert.equal(second.heldMs, 0, "it joined the first");
});

test("a caller that asks once the read under way has begun reading replays its own", async () => {
  const db = await library();
  const { connection: inner } = countedReads(db);
  let begun!: () => void;
  const reading = new Promise<void>((resolve) => (begun = resolve));
  const connection: ReadConnection = {
    snapshot: (inSnapshot) => inner.snapshot((query) => (begun(), inSnapshot(query))),
  };
  const time = clock();
  const replays = sharedReplays(connection, time.now);
  const read = (d: LibraryDatabase) => {
    time.pass(1);
    return countTracks(d);
  };
  const before = replays(read);
  await reading;
  db.delete(schema.tracks)
    .where(
      inArray(
        schema.tracks.id,
        slowIds(db)
          .slice(0, 10)
          .map((row) => row.id),
      ),
    )
    .run();
  const after = await replays(read);
  assert.equal(after.value, 110, "sees its write");
  assert.ok(after.heldMs > 0, "its own replay ran");
  assert.ok((await before).heldMs > 0);
  // Different reads never share.
  const [one, other] = await Promise.all([replays(countTracks), replays(listSongs)]);
  assert.equal(one.value, 110);
  assert.equal(other.value.length, 110);
});
