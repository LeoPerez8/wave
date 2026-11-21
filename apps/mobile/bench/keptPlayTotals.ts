/**
 * The play totals' reads (#1349) before and after the kept totals of
 * migration 0069: "before" sums them from the history as every read did
 * (`summed*`, or the readers with the kept totals unsettled), "after" reads
 * the kept day and block sums. Each Library is #579's fixture with streamed
 * plays added (300 videos, 6,000 plays over the same 90 days, a third of them
 * crediting a Library artist). Checks both give the same totals, then prints
 * each read's median time. Then what the kept totals cost: a play as the
 * player writes it, and an upgrade's history summed in the startup job's
 * steps (the longest step of each kind, and the longest 6 ms slice).
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/keptPlayTotals.ts [--quick]
 */
import {
  runStepSlice,
  followSuggestionsWindow,
  inYourOrbitWindow,
  recentPlaysWindow,
  statsWindow,
  type FollowRelease,
  type PlayEvent,
  type StatsWindow,
} from "@wave/core";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { followReleaseListening } from "@wave/client/db/followReleases";
import {
  keptCreditedPlayTotals,
  keptPlayedTotals,
  keptSongPlayTotals,
  keptTotalsSteps,
  settleKeptTotalsSteps,
} from "@wave/client/db/keptPlayTotals";
import { endPlay, homePlays, recordPlay, updatePlay } from "@wave/client/db/playHistory";
import { summedPlayedTotals } from "@wave/client/db/playedEntities";
import { selectPlaylistPlays } from "@wave/client/db/playlists";
import { summedCreditedPlayTotals, summedSongPlayTotals } from "@wave/client/db/stats";
import { createFastAgainFixture, FAST_AGAIN_DESKTOP } from "@wave/client/testing/fastAgainFixture";
import type { TestDatabase } from "@wave/client/testing";

import { median, timeRuns } from "./measure.ts";

const quick = process.argv.includes("--quick");
const RUNS = quick ? 5 : 21;
const STREAMED_PLAYS = 6_000;

const addStreamedPlays = (db: TestDatabase, now: number) =>
  db.run(sql`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < ${STREAMED_PLAYS - 1})
    INSERT INTO play_events (video_id, streamed_song, started_at, listened_ms, duration_ms,
      end_reason, counted, source, recording_key, sync_id, context_type, context_id)
    SELECT printf('v%010d', x % 300),
      json_object('videoId', printf('v%010d', x % 300), 'title', 'Song ' || (x % 300),
        'artists', json_array('Online artist ' || (x % 40),
          CASE WHEN x % 3 = 0 THEN 'Library artist 1' ELSE 'Guest ' || (x % 7) END),
        'album', 'Online album ' || (x % 60), 'durationMs', 180000, 'artworkUrl', NULL,
        'explicit', json('false'), 'albumId', printf('MPREb_%d', x % 60)),
      ${now} - (${STREAMED_PLAYS} - x) * ${Math.floor((90 * 86_400_000) / STREAMED_PLAYS)},
      180000, 180000, 'completed', x % 5 <> 0, 'phone', 'yt-rec-' || (x % 300), 'stream-' || x,
      CASE WHEN x % 4 = 0 THEN 'playlist' END, CASE WHEN x % 4 = 0 THEN CAST(x % 9 AS text) END
    FROM n`);

/** The Library store's step (`KEPT_TOTALS_STEP` in `LibraryStore.ts`). */
const KEPT_TOTALS_STEP = { songs: 2, plays: 250, days: 24 };

/** The app's pace (`GENTLE_STEPS` in `lib/stepped.ts`). */
const GENTLE_STEPS = { sliceMs: 6, maxSteps: 512 };

/** Drops every kept total, as a database upgraded to 0069 with this history has them. */
const asUpgrade = (db: TestDatabase) => {
  for (const table of [
    "play_credits",
    "credited_buckets",
    "play_buckets",
    "played_songs",
    "played_entities",
    "played_recordings",
    "playlist_play_buckets",
  ])
    db.run(sql.raw(`DELETE FROM ${table}`));
  db.run(sql`UPDATE kept_totals_state SET generation = generation + 1, seeded_through = 0,
    seed_until = coalesce((SELECT max(id) FROM play_events), 0)`);
};

/** What the next settle piece does, for the longest step of each. */
const pieceOf = (db: TestDatabase): string => {
  const kept = db.get<{ seeding: number; summing: number }>(sql`SELECT
    seeded_through < seed_until AS seeding,
    EXISTS (SELECT 1 FROM played_songs WHERE state = 0) AS summing FROM kept_totals_state`);
  return kept.seeding === 1 ? "seed plays" : kept.summing === 1 ? "sum songs" : "credit songs";
};

/** Makes the kept totals owe a step, so the readers sum from the history as before. */
const unsettled = <A>(db: TestDatabase, read: () => A): A => {
  const kept = db.get<{ seedUntil: number }>(
    sql`SELECT seed_until AS "seedUntil" FROM kept_totals_state`,
  );
  db.run(sql`UPDATE kept_totals_state SET seed_until = seeded_through + 1`);
  try {
    return read();
  } finally {
    db.run(sql`UPDATE kept_totals_state SET seed_until = ${kept.seedUntil}`);
  }
};

const sameRows = <A>(a: readonly A[], b: readonly A[]) =>
  assert.deepEqual(
    a.map((row) => JSON.stringify(row)).toSorted(),
    b.map((row) => JSON.stringify(row)).toSorted(),
  );

const ids = (totals: {
  readonly albums: readonly { id: unknown; countedPlays: number }[];
  readonly artists: readonly { id: unknown; countedPlays: number }[];
}) => ({
  albums: totals.albums.map((entry) => [entry.id, entry.countedPlays]),
  artists: totals.artists.map((entry) => [entry.id, entry.countedPlays]),
});

const play = (trackId: string, startedAt: number, listenedMs: number): PlayEvent => ({
  trackId,
  context: null,
  startedAt,
  listenedMs,
  durationMs: 180_000,
  endReason: listenedMs >= 180_000 ? "completed" : "stopped",
  counted: listenedMs > 15_000,
  source: "phone",
});

console.log(FAST_AGAIN_DESKTOP);
for (const size of quick ? ([1000] as const) : ([1000, 12000] as const)) {
  const fixture = await createFastAgainFixture(size);
  const { db, now } = fixture;
  addStreamedPlays(db, now);
  // Each step as the app's slices run it: one `next()` of the settle's steps, at the store's size.
  asUpgrade(db);
  const steps: number[] = [];
  const longest = new Map<string, number>();
  const byPiece: Record<string, number[]> = {};
  for (let done = false; !done;) {
    const piece = pieceOf(db);
    const settling = settleKeptTotalsSteps(db, KEPT_TOTALS_STEP);
    for (let index = 0; ; index++) {
      const before = performance.now();
      const next = settling.next();
      const ms = performance.now() - before;
      steps.push(ms);
      const kind = index === 0 ? piece : "build the resolver";
      longest.set(kind, Math.max(longest.get(kind) ?? 0, ms));
      (byPiece[kind] ??= []).push(ms);
      if (next.done === true) {
        done = next.value;
        break;
      }
    }
  }
  console.log(
    `
${size} songs, ${fixture.playEvents + STREAMED_PLAYS} plays: an upgrade settled in ` +
      `${steps.length} steps, longest ${Math.max(...steps).toFixed(1)} ms, median ${median(steps)} ms, ` +
      `${steps.filter((ms) => ms > 8).length} past 8 ms`,
  );
  for (const [kind, times] of Object.entries(byPiece))
    console.log(
      `  ${kind}: ${times.length} steps, median ${median(times)} ms, ` +
        `longest ${longest.get(kind)!.toFixed(1)} ms, ${times.filter((ms) => ms > 8).length} past 8 ms`,
    );
  // The same through Core's slices at the app's pace (6 ms planned, 512 steps at most).
  asUpgrade(db);
  const slices: number[] = [];
  const all = keptTotalsSteps(db, KEPT_TOTALS_STEP);
  for (;;) {
    const before = performance.now();
    const slice = runStepSlice(all, { now: () => performance.now(), ...GENTLE_STEPS });
    slices.push(performance.now() - before);
    if (slice.done) break;
  }
  console.log(
    `  in 6 ms slices: ${slices.length} slices, longest ${Math.max(...slices).toFixed(1)} ms, ` +
      `${slices.filter((ms) => ms > 8).length} past 8 ms`,
  );
  const windows: [string, StatsWindow][] = [
    ["Stats week", statsWindow("week", now)],
    ["Stats month", statsWindow("month", now)],
    ["Stats year", statsWindow("year", now)],
    ["Stats all time", statsWindow("all", now)],
    ["In your orbit (14 days)", inYourOrbitWindow(now)],
    ["Follow suggestions (90 days)", followSuggestionsWindow(now)],
  ];
  const row = (label: string, before: () => unknown, after: () => unknown) => {
    const summed = timeRuns(before, RUNS);
    const kept = timeRuns(after, RUNS);
    console.log(
      `${label.padEnd(56)} ${String(summed.ms).padStart(8)} ms → ${String(kept.ms).padStart(6)} ms`,
    );
  };
  for (const [name, window] of windows) {
    assert.deepEqual(
      ids(keptPlayedTotals(db, window, true)!),
      ids(summedPlayedTotals(db, window, true)),
    );
    row(
      `sum up played albums and artists, ${name}`,
      () => summedPlayedTotals(db, window, true),
      () => keptPlayedTotals(db, window, true),
    );
  }
  row(
    "sum up played artists, In your orbit",
    () => summedPlayedTotals(db, inYourOrbitWindow(now), false),
    () => keptPlayedTotals(db, inYourOrbitWindow(now), false),
  );
  sameRows(
    keptSongPlayTotals(db, recentPlaysWindow(now))!,
    summedSongPlayTotals(db, recentPlaysWindow(now)),
  );
  row(
    "sum up song plays, most listened recently (14 days)",
    () => summedSongPlayTotals(db, recentPlaysWindow(now)),
    () => keptSongPlayTotals(db, recentPlaysWindow(now)),
  );
  sameRows(
    keptCreditedPlayTotals(db, statsWindow("all", now))!,
    summedCreditedPlayTotals(db, statsWindow("all", now)),
  );
  row(
    "sum up album and artist plays, all time",
    () => summedCreditedPlayTotals(db, statsWindow("all", now)),
    () => keptCreditedPlayTotals(db, statsWindow("all", now)),
  );
  assert.deepEqual(
    homePlays(db),
    unsettled(db, () => homePlays(db)),
  );
  row(
    "read Home's plays",
    () => unsettled(db, () => homePlays(db)),
    () => homePlays(db),
  );
  assert.deepEqual(
    selectPlaylistPlays(db, now),
    unsettled(db, () => selectPlaylistPlays(db, now)),
  );
  row(
    "count the playlists' plays (From your library)",
    () => unsettled(db, () => selectPlaylistPlays(db, now)),
    () => selectPlaylistPlays(db, now),
  );
  const release: FollowRelease = {
    key: "deezer:1",
    artistKey: "library artist 1",
    title: "Library album 1",
    type: "album",
    releaseDate: "2026-10-01",
    artworkUrl: null,
    explicit: false,
    browseId: null,
    videoIds: ["v0000000000"],
    recordingKeys: ["yt-rec-0", "yt-rec-1", "library-recording-3"],
  };
  assert.deepEqual(
    followReleaseListening(db, [release]),
    unsettled(db, () => followReleaseListening(db, [release])),
  );
  row(
    "read release listening",
    () => unsettled(db, () => followReleaseListening(db, [release])),
    () => followReleaseListening(db, [release]),
  );
  // A play as the player writes it: start, progress, end; triggers and the in-write credit included.
  let at = now + 1_000;
  const write = timeRuns(() => {
    at += 200_000;
    const track = String(fixture.songIds[((at / 200_000) % fixture.songIds.length) | 0]);
    const id = recordPlay(db, play(track, at, 0));
    updatePlay(db, id, play(track, at, 30_000));
    endPlay(db, id, play(track, at, 180_000));
  }, RUNS);
  console.log(
    `${"a Library play written (start, progress, end)".padEnd(56)} ${String(write.ms).padStart(8)} ms`,
  );
  fixture.close();
}
