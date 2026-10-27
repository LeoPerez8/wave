/// <reference types="node" />
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import initSqlJs from "sql.js";

import { configureConnection, optimizeDatabase } from "./connection.ts";
import { recordPlay } from "./playHistory.ts";
import { addHistory, addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const pragma = (exec: (text: string) => unknown[][], name: string): unknown =>
  exec(`PRAGMA ${name}`)[0]?.[0];

describe("The Library's connection", () => {
  test("suits a phone: WAL with a normal sync, temp tables in memory, a larger cache", async () => {
    const SQL = await initSqlJs();
    const client = new SQL.Database();
    const exec = (text: string) => client.exec(text)[0]?.values ?? [];
    const defaultCache = Number(pragma(exec, "cache_size"));

    configureConnection((statements) => client.exec(statements));

    assert.equal(pragma(exec, "journal_mode"), "wal");
    // NORMAL: safe with WAL, without a full disk sync on every commit.
    assert.equal(pragma(exec, "synchronous"), 1);
    // MEMORY.
    assert.equal(pragma(exec, "temp_store"), 2);
    assert.equal(pragma(exec, "foreign_keys"), 1);
    // Negative sizes are KiB: the cache is larger than SQLite's default.
    assert.ok(-Number(pragma(exec, "cache_size")) > -defaultCache);
    // ANALYZE samples a bounded number of rows, so optimizing stays cheap.
    assert.ok(Number(pragma(exec, "analysis_limit")) > 0);
    client.close();
  });
});

describe("Optimizing the database", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await openTestDatabase();
  });

  const statistics = (): string[] =>
    db
      .all<{ tbl: string }>(sql`SELECT DISTINCT tbl FROM sqlite_stat1 ORDER BY tbl`)
      .map((row) => row.tbl);

  test("after opening, gives the play history statistics the planner can use", () => {
    addHistory(db, { artist: "Artist", tracks: 20, plays: 2_000 });

    optimizeDatabase(db, "opened");

    assert.ok(statistics().includes("play_events"));
  });

  test("on leaving the app, refreshes statistics the session's reads made stale", () => {
    addHistory(db, { artist: "Artist", tracks: 20, plays: 2_000 });
    optimizeDatabase(db, "opened");
    const before = db.get<{ stat: string }>(
      sql`SELECT stat FROM sqlite_stat1 WHERE idx = 'play_events_track_idx'`,
    )!.stat;
    addHistory(db, { artist: "Another", tracks: 20, plays: 60_000 });
    // A read through the index, as the session's queries leave behind.
    recordPlay(db, {
      trackId: String(addTrack(db, { title: "Now" })),
      context: null,
      startedAt: 1,
      listenedMs: 0,
      durationMs: 1,
      endReason: "skipped",
      counted: false,
      source: "phone",
    });
    db.all(sql`SELECT count(*) FROM play_events WHERE track_id = 1`);

    optimizeDatabase(db, "leaving");

    const after = db.get<{ stat: string }>(
      sql`SELECT stat FROM sqlite_stat1 WHERE idx = 'play_events_track_idx'`,
    )!.stat;
    assert.notEqual(after, before);
  });
});
