/**
 * Home's all-time listening reads (#312) against a growing history: before,
 * the whole history (Recently Played and Most Played grouped every play,
 * the overview summed every song's listening, all-time album and artist
 * rankings summed every counted play); after, the play totals the triggers
 * of migration 0022 keep (`play_totals`). Checks that both give the same
 * result at every size, then prints, per size and read, the statements run,
 * the rows they returned and the median time, and each statement's plan once.
 * Then the cost the totals add: recording a play (start, progress, end), a
 * BlackPlayer import of 18,000 plays, and the migration's one-time backfill.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/homeTotals.ts [--quick]
 */
import {
  listeningTotals,
  statsWindow,
  summedListeningTotals,
  type CreditedPlayTotals,
  type PlayEvent,
} from "@wave/core";
import { desc, eq, inArray, max, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { selectAlbums } from "../src/library/db/albums.ts";
import { saveImportedPlays } from "../src/library/db/blackPlayer.ts";
import { libraryCounts } from "../src/library/db/counts.ts";
import {
  endPlay,
  homeAdded,
  homeFavorites,
  homePlays,
  recordPlay,
  updatePlay,
} from "../src/library/db/playHistory.ts";
import { listeningSums, playTotalsDrift } from "../src/library/db/playTotals.ts";
import * as schema from "../src/library/db/schema.ts";
import { creditedPlayTotals, songListening } from "../src/library/db/stats.ts";
import {
  addHistory,
  migrateTestDatabase,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
} from "../src/library/db/testDatabase.ts";
import { songColumns } from "../src/library/db/tracks.ts";

const quick = process.argv.includes("--quick");
const now = 10_000_000_000;
/** Artists added before each measurement, each with `PER_ARTIST`. */
const LEVELS = quick ? [1, 3] : [1, 10, 30];
const PER_ARTIST = { tracks: 1_000, plays: 10_000, albums: 100 };
const RUNS = quick ? 5 : 41;

// What Home read before #312 (c9fa645 `db/playHistory.ts`), kept here to compare,
// with the tie-breaks #312 adds (c9fa645 left ties to SQLite): Recently Played's
// albums by id, Most Played's songs by id, the latest added first. `addHistory`
// gives every artist's plays the same times, so ties are everywhere here.

const SHELF = 12;
const LIST = 10;

const recentlyPlayedBefore = (db: TestDatabase) => {
  const { playEvents, tracks } = schema;
  const ids = db
    .select({ id: tracks.albumId })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .groupBy(tracks.albumId)
    .orderBy(desc(max(playEvents.startedAt)), desc(tracks.albumId))
    .limit(SHELF)
    .all()
    .map((row) => row.id);
  if (ids.length === 0) return [];
  const byId = new Map(
    selectAlbums(db, inArray(schema.albums.id, ids)).map((row) => [row.id, row]),
  );
  return ids.flatMap((id) => byId.get(id) ?? []);
};

const mostPlayedBefore = (db: TestDatabase) => {
  const { playEvents, tracks, artists, albums, artwork } = schema;
  const playCount = sql<number>`count(*)`;
  return db
    .select({ ...songColumns, playCount })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(playEvents.counted, true))
    .groupBy(tracks.id)
    .orderBy(desc(playCount), desc(max(playEvents.startedAt)), desc(tracks.id))
    .limit(LIST)
    .all();
};

const byCredit = (rows: readonly CreditedPlayTotals[]) =>
  rows.toSorted(
    (a, b) =>
      a.albumId - b.albumId || a.artistId - b.artistId || Number(a.primary) - Number(b.primary),
  );

const allTime = statsWindow("all", now);
/** A window with a start reads the play events, as every window did before #312. */
const wholeHistory = { from: Number.MIN_SAFE_INTEGER, to: now };

type Pair = {
  readonly before: (db: TestDatabase) => unknown;
  readonly after: (db: TestDatabase) => unknown;
};

const READS: Record<string, Pair> = {
  /** Recently Played and Most Played. */
  "home-plays": {
    before: (db) => ({
      recentlyPlayed: recentlyPlayedBefore(db),
      mostPlayed: mostPlayedBefore(db),
    }),
    after: (db) => homePlays(db),
  },
  /** The overview's listening totals. */
  "overview-listening": {
    before: (db) => listeningTotals(songListening(db)),
    after: (db) => summedListeningTotals(listeningSums(db)),
  },
  /** What Most played albums and artists rank (before, each section read it; after, they share one read). */
  "all-time-credited": {
    before: (db) => byCredit(creditedPlayTotals(db, wholeHistory)),
    after: (db) => byCredit(creditedPlayTotals(db, allTime)),
  },
  /**
   * Everything Home re-read after a play while in sight. Before: all four
   * sections, the overview (counts and every song's listening) and the
   * credited totals once per ranking section. After: the play sections, the
   * listening sums and the credited totals once for both rankings; Recently
   * Added, Favorites and the counts aren't re-read for a play.
   */
  "refresh-after-play": {
    before: (db) => [
      homeAdded(db),
      READS["home-plays"]!.before(db),
      homeFavorites(db),
      libraryCounts(db),
      READS["overview-listening"]!.before(db),
      READS["all-time-credited"]!.before(db),
      READS["all-time-credited"]!.before(db),
    ],
    after: (db) => [
      homePlays(db),
      READS["overview-listening"]!.after(db),
      READS["all-time-credited"]!.after(db),
    ],
  },
};

const median = (samples: number[]): number => {
  const sorted = samples.toSorted((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(2));
};

/** [run]'s median wall time and mean CPU time (Windows counts CPU in 15.6 ms ticks), after a warm-up. */
const time = (run: () => unknown, runs = RUNS) => {
  run();
  const wall: number[] = [];
  const cpuBefore = process.cpuUsage();
  for (let i = 0; i < runs; i++) {
    const before = performance.now();
    run();
    wall.push(performance.now() - before);
  }
  const cpu = process.cpuUsage(cpuBefore);
  return { ms: median(wall), cpuMs: Number(((cpu.user + cpu.system) / 1_000 / runs).toFixed(2)) };
};

const count = (db: TestDatabase, table: "tracks" | "play_events" | "play_totals") =>
  db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table}`)).n;

const print = (line: object) => console.log(JSON.stringify(line));

print({
  kind: "meta",
  note: "Desktop: Node + sql.js (WebAssembly SQLite), not phone timings.",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  runs: RUNS,
});

/** Measures every read before and after on [db], checking they agree. */
const measureReads = (db: TestDatabase, label: string, plansShown: Set<string>) => {
  for (const [read, pair] of Object.entries(READS)) {
    const traced = {
      before: traceQueries(db, () => pair.before(db)),
      after: traceQueries(db, () => pair.after(db)),
    };
    // The refresh reads different sets before and after; its parts are compared above.
    if (read !== "refresh-after-play")
      assert.deepEqual(traced.after.result, traced.before.result, `${label} ${read}`);
    for (const which of ["before", "after"] as const) {
      const { queries } = traced[which];
      print({
        kind: "read",
        library: label,
        read,
        which,
        libraryTracks: count(db, "tracks"),
        playEvents: count(db, "play_events"),
        playedTracks: count(db, "play_totals"),
        statements: queries.length,
        rowsReturned: queries.reduce((sum, query) => sum + query.rows, 0),
        ...time(() => pair[which](db)),
      });
      const shown = `${read}:${which}`;
      if (plansShown.has(shown) || read === "refresh-after-play") continue;
      plansShown.add(shown);
      for (const query of queries) {
        print({
          kind: "plan",
          read,
          which,
          sql: query.sql.replaceAll(/\s+/g, " ").slice(0, 160),
          plan: query.plan,
        });
      }
    }
  }
};

// Reads, over many albums (100 per artist), at every size.
const db = await openTestDatabase();
const plansShown = new Set<string>();
let added = 0;
for (const level of LEVELS) {
  for (; added < level; added++) addHistory(db, { artist: `Artist ${added + 1}`, ...PER_ARTIST });
  measureReads(db, "many albums", plansShown);
}
assert.deepEqual(playTotalsDrift(db), []);

// Recently Played's worst case: every artist's songs on one album, so the
// shelf can't fill and reads every played song, a page at a time.
const fewAlbums = await openTestDatabase();
for (let artist = 0; artist < 10; artist++)
  addHistory(fewAlbums, { artist: `Artist ${artist + 1}`, tracks: 1_000, plays: 10_000 });
measureReads(fewAlbums, "10 albums", plansShown);

// What keeping the totals costs a write, with the triggers and without them.
const play = (
  trackId: number,
  startedAt: number,
  listenedMs: number,
  counted: boolean,
): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs,
  durationMs: 180_000,
  endReason: counted ? "completed" : "stopped",
  counted,
  source: "phone",
});
/** A Library of 10,000 songs and 100,000 plays to write to, with the triggers or without them. */
const writer = async (triggers: boolean) => {
  const library = await openTestDatabase();
  for (let artist = 0; artist < 10; artist++)
    addHistory(library, { artist: `Artist ${artist + 1}`, ...PER_ARTIST });
  if (!triggers)
    for (const trigger of ["insert", "grow", "change", "delete"])
      library.run(sql.raw(`DROP TRIGGER play_totals_${trigger}`));
  const tracks = library
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .limit(2_000)
    .all()
    .map((row) => row.id);
  let at = now;
  return {
    triggers,
    library,
    /** A play as the player writes it: started, brought up to date (now counted), ended. */
    play: () => {
      at += 1_000;
      const id = recordPlay(library, play(tracks[0]!, at, 0, false));
      updatePlay(library, id, play(tracks[0]!, at, 20_000, true));
      endPlay(library, id, play(tracks[0]!, at, 180_000, true));
    },
    /** BlackPlayer's stats: 18,000 plays over 2,000 songs, in one transaction. */
    import: () => {
      at += 100_000;
      saveImportedPlays(
        library,
        Array.from({ length: 18_000 }, (_, i) => ({
          trackId: tracks[i % tracks.length]!,
          startedAt: at + i,
        })),
      );
    },
  };
};
// Two equal Libraries, written to in turn, so each write meets the same history.
const writers = [await writer(true), await writer(false)];
for (const write of ["play", "import"] as const) {
  for (const { triggers, library, ...run } of writers) {
    print({
      kind: "write",
      write: write === "play" ? "play" : "import-18000",
      triggers,
      playEvents: count(library, "play_events"),
      ...time(run[write], write === "play" ? RUNS : 3),
    });
  }
}
assert.deepEqual(playTotalsDrift(writers[0]!.library), []);

// The migration's one-time backfill, on a database as 0021 left it.
const upgrading = await openTestDatabase({ through: "0021_playlist_images" });
for (let artist = 0; artist < 10; artist++)
  addHistory(upgrading, { artist: `Artist ${artist + 1}`, ...PER_ARTIST });
const started = performance.now();
await migrateTestDatabase(upgrading);
print({
  kind: "migrate",
  migration: "0022_play_totals",
  playEvents: count(upgrading, "play_events"),
  playedTracks: count(upgrading, "play_totals"),
  ms: Number((performance.now() - started).toFixed(2)),
});
assert.deepEqual(playTotalsDrift(upgrading), []);
