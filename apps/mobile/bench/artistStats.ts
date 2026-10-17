/**
 * The artist page's stats reads (#311) against a growing history of other
 * artists' plays: before, the whole history (`songListening`, all-time
 * `trackPlayTotals`, `songsCrediting`, as `Stats.artist` read them); after,
 * the artist's own plays (`artistPlays`). Checks that both give the same stats
 * block at every size, then prints, per size and read, the statements run,
 * the rows they returned and the median time, and each statement's plan once.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/artistStats.ts [--quick]
 */
import { artistStats, statsWindow } from "@wave/core";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";

import { creditSplits, relinkCredits } from "../src/library/db/credits.ts";
import { recordPlay } from "../src/library/db/playHistory.ts";
import * as schema from "../src/library/db/schema.ts";
import {
  artistPlays,
  songListening,
  songsCrediting,
  trackPlayTotals,
} from "../src/library/db/stats.ts";
import {
  addHistory,
  addTrack,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
} from "../src/library/db/testDatabase.ts";
import { deleteTracks } from "../src/library/db/tracks.ts";
import { printMeta, timeRuns } from "./measure.ts";

const quick = process.argv.includes("--quick");
const now = 10_000_000_000;
/** Other artists' history added before each measurement: [songs, plays] per artist, artists. */
const LEVELS = quick ? [0, 1, 3] : [0, 1, 10, 30];
const PER_ARTIST = { tracks: 1_000, plays: 10_000 };
const RUNS = quick ? 5 : 41;

const db: TestDatabase = await openTestDatabase();

// The artist whose page opens: 120 songs and 2,400 plays (one in ten of songs
// since deleted), a collaboration with another artist, and a song deleted
// after its plays.
addHistory(db, { artist: "Selected Artist", tracks: 120, plays: 2_400 });
const collaboration = addTrack(db, { title: "Together", artist: "Selected Artist, Guest" });
const gone = addTrack(db, { title: "Gone", artist: "Selected Artist" });
relinkCredits(db, creditSplits());
for (let at = 0; at < 30; at++) {
  for (const trackId of [collaboration, gone]) {
    recordPlay(db, {
      trackId: String(trackId),
      context: null,
      startedAt: 5_000 + at,
      listenedMs: 200_000,
      durationMs: 200_000,
      endReason: "completed",
      counted: true,
      source: "phone",
    });
  }
}
const gonePath = db.select().from(schema.tracks).where(eq(schema.tracks.id, gone)).get()?.path;
if (gonePath == null) throw new Error("no file for the deleted song");
deleteTracks(db, [gonePath]);
const selected = db
  .select({ id: schema.artists.id })
  .from(schema.artists)
  .where(eq(schema.artists.name, "Selected Artist"))
  .get()!.id;

const reads = {
  before: () =>
    artistStats({
      artistId: selected,
      songIds: songsCrediting(db, selected),
      listening: songListening(db),
      songPlays: trackPlayTotals(db, statsWindow("all", now)),
      now,
    }),
  after: () => artistStats({ artistId: selected, now, ...artistPlays(db, selected, now) }),
};

const count = (table: "tracks" | "play_events") =>
  db.get<{ n: number }>(
    table === "tracks"
      ? "SELECT count(*) AS n FROM tracks"
      : "SELECT count(*) AS n FROM play_events",
  )!.n;

printMeta({ runs: RUNS });

let added = 0;
const plansShown = new Set<string>();
for (const level of LEVELS) {
  for (; added < level; added++)
    addHistory(db, { artist: `Other Artist ${added + 1}`, ...PER_ARTIST });
  const traced = {
    before: traceQueries(db, reads.before),
    after: traceQueries(db, reads.after),
  };
  assert.deepEqual(traced.after.result, traced.before.result);
  assert.ok(traced.after.result.played);
  for (const which of ["before", "after"] as const) {
    const { queries } = traced[which];
    console.log(
      JSON.stringify({
        kind: "artist-stats",
        read: which,
        libraryTracks: count("tracks"),
        playEvents: count("play_events"),
        statements: queries.length,
        rowsReturned: queries.reduce((sum, query) => sum + query.rows, 0),
        rowsPerStatement: queries.map((query) => query.rows),
        ...timeRuns(reads[which], RUNS),
      }),
    );
    if (plansShown.has(which)) continue;
    plansShown.add(which);
    for (const query of queries) {
      console.log(
        JSON.stringify({
          kind: "plan",
          read: which,
          sql: query.sql.replaceAll(/\s+/g, " ").slice(0, 160),
          plan: query.plan,
        }),
      );
    }
  }
}
