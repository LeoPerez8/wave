/**
 * What migration 0069's triggers (#1349) add to a full scan and a sync pull:
 * the same work on a database with the kept totals' triggers and on one with
 * them dropped. The scan saves 12,000 new files in the scanner's batches of
 * 500 (`saveBatch`); the pull applies 60,000 plays (two in three of those
 * files' songs, one in three streamed, a quarter from playlists) in pages of
 * 500 (`applyPulledPage`). Both orders run: a phone that scans and then pulls
 * its account, and one that pulls first, settles its kept totals, then scans
 * (each new file then marks the plays already kept for its song owed).
 * With the triggers, it also prints the job's settling after the pull: work
 * that runs in the scheduler's slices, not in a page's write.
 * Prints the total and the longest batch or page for each.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite or Hermes. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/keptTotalsTriggers.ts [--quick]
 */
import { EMPTY_SYNC_TABLES, normalizeTrack, recordingKey, type SyncPlayRow } from "@wave/core";
import { sql } from "drizzle-orm";
import { performance } from "node:perf_hooks";

import type { IndexedTrack } from "@wave/client";
import { creditSplits } from "@wave/client/db/credits";
import { keptTotalsSteps } from "@wave/client/db/keptPlayTotals";
import { saveBatch } from "@wave/client/db/save";
import { applyPulledPage } from "@wave/client/db/syncRows";
import { openTestDatabase, type TestDatabase } from "@wave/client/testing";

const quick = process.argv.includes("--quick");
const SONGS = quick ? 1_000 : 12_000;
const PLAYS = quick ? 5_000 : 60_000;
/** The scanner's batch (`LibraryScanner.batchSize`), and a pull page's plays. */
const BATCH = 500;
const ROOT = "/storage/emulated/0/Music";
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const splits = creditSplits();

const file = (n: number): IndexedTrack => ({
  ...normalizeTrack({
    path: `${ROOT}/Artist ${n % 300}/Album ${n % 900}/${n} Song ${n}.flac`,
    title: `Song ${n}`,
    artist: n % 4 === 0 ? `Artist ${n % 300} feat. Artist ${(n + 7) % 300}` : `Artist ${n % 300}`,
    album: `Album ${n % 900}`,
    albumArtist: `Artist ${n % 300}`,
    trackNumber: String((n % 12) + 1),
    genre: `Genre ${n % 25}`,
    year: String(1970 + (n % 50)),
    durationMs: 180_000 + (n % 120_000),
  }),
  sizeBytes: 20_000_000 + n,
  modifiedAt: 1_700_000_000_000 + n,
  sampleRate: 44_100,
  bitrateKbps: 900,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
});
const files = Array.from({ length: SONGS }, (_, n) => file(n));
const keys = files.map((track) => recordingKey(track));

const play = (x: number): SyncPlayRow => {
  const streamed = x % 3 === 2;
  const n = (x * 7919) % SONGS;
  const startedAt = NOW - Math.floor(((PLAYS - x) * 365 * DAY) / PLAYS);
  return {
    id: `play-${x}`,
    songId: streamed ? `yt-rec-${x % 400}` : keys[n]!,
    startedAt,
    listenedMs: 180_000,
    durationMs: 180_000,
    endReason: "completed",
    counted: x % 5 !== 0,
    contextType: x % 4 === 0 ? "playlist" : null,
    contextId: x % 4 === 0 ? String(x % 9) : null,
    source: "phone",
    importedFrom: null,
    snapshot: streamed
      ? {
          title: `Online ${x % 400}`,
          artist: `Online artist ${x % 40}`,
          album: null,
          artworkPath: null,
          thumbPath: null,
        }
      : {
          title: `Song ${n}`,
          artist: `Artist ${n % 300}`,
          album: `Album ${n % 900}`,
          artworkPath: null,
          thumbPath: null,
        },
    videoId: streamed ? `v${String(x % 400).padStart(10, "0")}` : null,
  };
};

const time = (run: () => unknown): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

interface Run {
  readonly total: number;
  readonly longest: number;
}
const summed = (blocks: number[]): Run => ({
  total: blocks.reduce((sum, ms) => sum + ms, 0),
  longest: Math.max(...blocks),
});

const scan = (db: TestDatabase): Run => {
  const blocks: number[] = [];
  for (let from = 0; from < SONGS; from += BATCH) {
    const batch = files.slice(from, from + BATCH);
    blocks.push(time(() => saveBatch(db, splits, batch, [], [], 0, { linkEntries: false })));
  }
  return summed(blocks);
};

const pull = (db: TestDatabase): Run => {
  const trackIds = new Map(
    db
      .all<{ id: number; key: string }>(
        sql`SELECT id, recording_key AS key FROM tracks WHERE recording_key IS NOT NULL`,
      )
      .map((row) => [row.key, row.id] as const),
  );
  const blocks: number[] = [];
  for (let from = 0; from < PLAYS; from += BATCH) {
    const plays = Array.from({ length: Math.min(BATCH, PLAYS - from) }, (_, i) => play(from + i));
    const page = { ...EMPTY_SYNC_TABLES, plays, cursor: String(from), more: true };
    blocks.push(time(() => applyPulledPage(db, page, trackIds, NOW)));
  }
  return summed(blocks);
};

const format = (run: Run) =>
  `${run.total.toFixed(0)} ms total, longest ${run.longest.toFixed(1)} ms`;

/** The Library store's step (`KEPT_TOTALS_STEP` in `LibraryStore.ts`). */
const KEPT_TOTALS_STEP = { songs: 2, plays: 250, days: 24 };

/** What the job's next step does: sum songs, count owed days again, or credit songs. */
const pieceOf = (db: TestDatabase): string => {
  const owed = db.get<{ sum: number; days: number; credit: number }>(sql`SELECT
    EXISTS (SELECT 1 FROM played_songs WHERE state = 0) AS sum,
    EXISTS (SELECT 1 FROM owed_days) AS days,
    EXISTS (SELECT 1 FROM played_songs WHERE state = 1) AS credit`);
  return owed.sum ? "sum" : owed.days ? "count days" : owed.credit ? "credit" : "last";
};

/** Runs the job's steps to the end, timing each; prints each piece's steps. */
const settled = (db: TestDatabase): Run => {
  const steps = keptTotalsSteps(db, KEPT_TOTALS_STEP);
  const blocks: number[] = [];
  const pieces = new Map<string, number[]>();
  for (;;) {
    const piece = pieceOf(db);
    const start = performance.now();
    const next = steps.next();
    const ms = performance.now() - start;
    blocks.push(ms);
    pieces.set(piece, [...(pieces.get(piece) ?? []), ms]);
    if (next.done !== true) continue;
    for (const [piece, times] of pieces) {
      const run = summed(times);
      const past = times.filter((ms) => ms > 8).length;
      console.log(`    ${piece}: ${times.length} steps, ${format(run)}, ${past} past 8 ms`);
    }
    return summed(blocks);
  }
};

const open = async (triggers: boolean): Promise<TestDatabase> => {
  const db = await openTestDatabase();
  if (!triggers) {
    for (const { name } of db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND substr(name, 1, 5) = 'kept_'`,
    )) {
      db.run(sql.raw(`DROP TRIGGER ${name}`));
    }
  }
  return db;
};

const added = (base: Run, kept: Run) =>
  `+${(kept.total - base.total).toFixed(0)} ms (${(((kept.total - base.total) / base.total) * 100).toFixed(1)}%)`;

console.log("Desktop: Node + sql.js (WebAssembly SQLite), not Hermes or the phone's SQLite.");
console.log(`${SONGS} files in batches of ${BATCH}, ${PLAYS} pulled plays in pages of ${BATCH}.`);

const results: Record<string, Run>[] = [];
for (const triggers of [false, true]) {
  const first = await open(triggers);
  const firstScan = scan(first);
  const thenPull = pull(first);
  const second = await open(triggers);
  const firstPull = pull(second);
  // What the job then settles in its slices, off the pull's pages.
  if (triggers) console.log("\nThe job's settling after the pull, by piece:");
  const settle = triggers ? settled(second) : { total: 0, longest: 0 };
  const thenScan = scan(second);
  results.push({ firstScan, thenPull, firstPull, thenScan });
  console.log(`\n${triggers ? "With" : "Without"} the kept totals' triggers:`);
  console.log(`  scan, empty history:        ${format(firstScan)}`);
  console.log(`  pull, after the scan:       ${format(thenPull)}`);
  console.log(`  pull, empty Library:        ${format(firstPull)}`);
  console.log(`  scan, after a settled pull: ${format(thenScan)}`);
  if (triggers) console.log(`  the job's settling after that pull:  ${format(settle)} (a step)`);
}
const [base, kept] = results as [Record<string, Run>, Record<string, Run>];
console.log("\nWhat the triggers add:");
for (const step of ["firstScan", "thenPull", "firstPull", "thenScan"]) {
  console.log(`  ${step.padEnd(10)} ${added(base[step]!, kept[step]!)}`);
}
