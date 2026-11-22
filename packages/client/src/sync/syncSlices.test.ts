/// <reference types="node" />
/**
 * A sync of a 3,000-song Library in background slices (#1450): between two of the app's
 * free turns, slices or requests, no step runs more than a bounded number of statements
 * or steps through more than a bounded number of rows, so none holds the JavaScript thread
 * for long while a screen shows. Counted, not timed: the same work takes some milliseconds
 * here and several times that on a phone, and a shared machine's clock is noisy. Each
 * test also prints the longest stretch it timed, for the record.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SliceResult } from "@wave/core";
import { sql } from "drizzle-orm";

import { creditSplits } from "../db/credits.ts";
import {
  addLibrary,
  closeTestDatabase,
  countStatements,
  openTestDatabase,
  type TestDatabase,
} from "../db/testDatabase.ts";
import {
  syncCycle,
  type SyncCycleInput,
  type SyncPreferences,
  type SyncTransport,
} from "./syncCycle.ts";
import { testSyncService, type TestSyncService } from "./testSyncService.ts";

const SONGS = 3_000;
const PLAYS = 6_000;

/**
 * What one stretch between yields may run. A stepped piece of 25 pulled plays runs about
 * four statements a play; a stepped read takes a few hundred rows.
 */
const MOST_STATEMENTS = 90;
const MOST_ROWS = 600;

/** The 3,000-song seed: its Tracks, each with its file, 6,000 plays and 300 stars. */
const seeded = async (): Promise<TestDatabase> => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: SONGS, artists: SONGS / 25, albums: SONGS / 10 });
  db.run(sql`UPDATE tracks SET path = '/Music/Library/m' || id || '.mp3' WHERE path IS NULL`);
  const first = db.get<{ id: number }>(sql`SELECT min(id) AS id FROM tracks`).id;
  db.run(sql`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < ${PLAYS - 1})
    INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted,
      source, recording_key, sync_id)
    SELECT ${first} + x % ${SONGS}, 1700000000000 + x * 60000, 180000, 180000, 'completed', 1,
      'phone', 'library-recording-' || (x % ${SONGS}), 'p-' || x FROM n`);
  db.run(sql`INSERT INTO favorites (track_id, added_at, changed_at, phone_id)
    SELECT id, 1700000000000, 1700000000000, 'seed' FROM tracks WHERE id % 10 = 0`);
  return db;
};

const preferences = (): SyncPreferences => {
  const stored = new Map<string, string>();
  return {
    value: (key) => stored.get(key) ?? null,
    apply: (key, value) => void (value === null ? stored.delete(key) : stored.set(key, value)),
  };
};

interface Stretch {
  readonly statements: number;
  readonly rows: number;
  readonly ms: number;
  readonly before: string;
}

/**
 * A sync of [db] with the app's ports, each yield one step at most (the app's slices run as
 * many as fit in 6 ms): every stretch of work between two yields is counted.
 */
const measuredSync = async (
  db: TestDatabase,
  service: TestSyncService,
  { songsChanged, sliced }: { readonly songsChanged: boolean; readonly sliced: boolean },
) => {
  const counter = countStatements(db);
  const stretches: Stretch[] = [];
  let from = counter.counted();
  let startedAt = performance.now();
  const cut = (before: string) => {
    const now = counter.counted();
    stretches.push({
      statements: now.statements - from.statements,
      rows: now.rows - from.rows,
      ms: performance.now() - startedAt,
      before,
    });
    from = now;
    startedAt = performance.now();
  };
  const transport: SyncTransport = {
    request: async (method, path, body) => {
      cut(`${method} ${path.split("?")[0]}`);
      const answer = await service.request(method, path, body);
      from = counter.counted();
      startedAt = performance.now();
      return answer;
    },
  };
  let clock = 1_800_000_000_000;
  const input: SyncCycleInput = {
    db,
    splits: creditSplits(),
    transport,
    preferences: preferences(),
    account: "ana@example.com",
    now: () => (clock += 1_000),
    songsChanged,
    wait: async () => {},
    turn: async () => {
      cut("turn");
      await Promise.resolve();
      from = counter.counted();
      startedAt = performance.now();
    },
    ...(sliced
      ? {
          slice: <A>(steps: Iterator<void, A>): SliceResult<A> => {
            const step = steps.next();
            cut("step");
            return step.done === true ? { done: true, value: step.value } : { done: false };
          },
        }
      : {}),
  };
  try {
    const result = await syncCycle(input);
    cut("end");
    return { result, stretches };
  } finally {
    counter.stop();
  }
};

const longest = (stretches: readonly Stretch[]) => ({
  statements: Math.max(...stretches.map((each) => each.statements)),
  rows: Math.max(...stretches.map((each) => each.rows)),
  ms: Math.max(...stretches.map((each) => each.ms)),
});

const report = (name: string, stretches: readonly Stretch[]) => {
  const most = longest(stretches);
  const total = stretches.reduce((sum, each) => sum + each.ms, 0);
  // oxlint-disable-next-line no-console -- the test's record of the times it saw
  console.log(
    `${name}: ${stretches.length} stretches, ${Math.round(total)} ms in all; the longest ` +
      `${most.ms.toFixed(1)} ms, ${most.statements} statements, ${most.rows} rows`,
  );
  return most;
};

const assertBounded = (name: string, stretches: readonly Stretch[]) => {
  const most = report(name, stretches);
  const over = stretches.filter(
    (each) => each.statements > MOST_STATEMENTS || each.rows > MOST_ROWS,
  );
  assert.deepEqual(
    over
      .slice(0, 5)
      .map((each) => `${each.statements} statements, ${each.rows} rows before ${each.before}`),
    [],
    `${over.length} stretches over the bound; the most ${most.statements} statements, ${most.rows} rows`,
  );
};

/** What a phone holds once synced, to compare a sliced sync with a whole one. */
const held = (db: TestDatabase) =>
  db.get<Record<string, number>>(sql`SELECT
    (SELECT count(*) FROM tracks) AS tracks,
    (SELECT count(*) FROM tracks WHERE path IS NULL) AS missing,
    (SELECT count(*) FROM play_events) AS plays,
    (SELECT count(*) FROM play_events WHERE track_id IS NULL) AS detached,
    (SELECT count(*) FROM play_events WHERE pushed = 0) AS unpushedPlays,
    (SELECT count(*) FROM favorites WHERE deleted = 0) AS stars,
    (SELECT count(*) FROM account_songs) AS accountSongs,
    (SELECT count(*) FROM account_songs WHERE pushed = 0) AS unpushedSongs,
    (SELECT count(*) FROM sync_pending) AS pending,
    (SELECT cursor FROM sync_state WHERE id = 1) AS cursor`);

describe("a sync of the 3,000-song seed in slices", { timeout: 600_000 }, () => {
  test("no stretch of the first syncs, a new phone's or a sync after a scan runs long", async () => {
    const service = testSyncService();
    const a = await seeded();
    const b = await seeded();
    const fresh = await openTestDatabase();
    try {
      const first = await measuredSync(a, service, { songsChanged: false, sliced: true });
      assert.equal(first.result.pushed > PLAYS, true);
      const second = await measuredSync(b, service, { songsChanged: false, sliced: true });
      const newPhone = await measuredSync(fresh, service, { songsChanged: false, sliced: true });
      const afterScan = await measuredSync(a, service, { songsChanged: true, sliced: true });

      assert.equal(held(fresh).plays, service.rows().plays.length);
      assert.equal(held(fresh).pending, 0);
      assertBounded("first sync", first.stretches);
      assertBounded("second phone's first sync", second.stretches);
      assertBounded("a new phone's first sync", newPhone.stretches);
      assertBounded("a sync after a scan", afterScan.stretches);
    } finally {
      for (const db of [a, b, fresh]) closeTestDatabase(db);
    }
  });

  test("ends where a sync with no slices ends", async () => {
    const run = async (sliced: boolean) => {
      const service = testSyncService();
      const a = await seeded();
      const fresh = await openTestDatabase();
      try {
        const first = await measuredSync(a, service, { songsChanged: false, sliced });
        const newPhone = await measuredSync(fresh, service, { songsChanged: false, sliced });
        if (!sliced) report("first sync, whole", first.stretches);
        if (!sliced) report("a new phone's first sync, whole", newPhone.stretches);
        return { a: held(a), fresh: held(fresh), pushed: first.result.pushed };
      } finally {
        closeTestDatabase(a);
        closeTestDatabase(fresh);
      }
    };

    assert.deepEqual(await run(true), await run(false));
  });
});
