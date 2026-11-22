/**
 * Home's large Library reads replayed off the JS thread (#1348, #1435, #1452), at the
 * reference phone's row counts: 26,730 playlist entries and 20,538 known videos. For
 * each read: the JS it holds and its passes the first time it runs, the next time it
 * runs, and when a mix build asks for it three times at once. Also the longest step
 * (a pass, or a step of mapping rows), which the app names "Library read replay".
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the phone's
 * SQLite or Hermes. SQLite's own time isn't counted: it runs off the JS thread on the
 * phone. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/replayReads.ts [--quick]
 */
import { writePlaylistYtSong } from "@wave/core";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import type { LibraryDatabase } from "@wave/client/db/database";
import { mixPlaylisted } from "@wave/client/db/mixInputs";
import { selectKnownVideos } from "@wave/client/db/mixKnown";
import * as offThread from "@wave/client/db/offThreadReads";
import { selectPlaylistEntryVideoIds } from "@wave/client/db/playlists";
import * as schema from "@wave/client/db/schema";
import { addLibrary, asyncReadClient, openTestDatabase } from "@wave/client/testing";
import { median, printMeta } from "./measure.ts";

const quick = process.argv.includes("--quick");
const runs = quick ? 3 : 7;

/** The reference phone's counts (spec #1432). */
const ENTRIES = 26_730;
const KNOWN = 20_538;
// Playlist entries hold 15,000 videos (some in several playlists); the rest of the known
// videos were only streamed: before streamed plays were recorded, and since.
const ENTRY_VIDEOS = 15_000;
const STREAMED_SONGS = 2_000;
const STREAMED_TOTALS = KNOWN - ENTRY_VIDEOS - STREAMED_SONGS;

const video = (n: number) => `v${n.toString(36).padStart(10, "0")}`;
const song = (n: number) =>
  writePlaylistYtSong({
    videoId: video(n),
    title: `Song ${n}`,
    artists: [`Artist ${n % 900}`],
    album: `Album ${n % 2_000}`,
    durationMs: 200_000 + (n % 60_000),
    artworkUrl: `https://lh3.googleusercontent.com/${video(n)}=w544-h544`,
    explicit: n % 7 === 0,
  });

const seed = async () => {
  const db = await openTestDatabase();
  addLibrary(db, { tracks: 300, artists: 30, albums: 40 });
  const playlists = Array.from({ length: 60 }, (_, n) =>
    db
      .insert(schema.playlists)
      .values({ name: `Playlist ${n}`, createdAt: n, updatedAt: n, changedAt: n })
      .returning({ id: schema.playlists.id })
      .get(),
  );
  for (let start = 0; start < ENTRIES; start += 500) {
    const items = [];
    for (let n = start; n < Math.min(ENTRIES, start + 500); n++)
      items.push({
        playlistId: playlists[n % playlists.length]!.id,
        ytSong: song(n % ENTRY_VIDEOS),
        orderKey: `k${n.toString(36).padStart(6, "0")}`,
        addedAt: 1_700_000_000_000 + n,
        changedAt: n,
      });
    db.insert(schema.playlistItems).values(items).run();
  }
  for (let start = 0; start < STREAMED_SONGS; start += 500) {
    const rows = [];
    for (let n = start; n < Math.min(STREAMED_SONGS, start + 500); n++)
      rows.push({
        videoId: video(ENTRY_VIDEOS + n),
        song: song(ENTRY_VIDEOS + n),
        plays: 1 + (n % 9),
        firstPlayedAt: n,
        lastPlayedAt: n,
      });
    db.insert(schema.streamedSongs).values(rows).run();
  }
  for (let start = 0; start < STREAMED_TOTALS; start += 500) {
    const rows = [];
    for (let n = start; n < Math.min(STREAMED_TOTALS, start + 500); n++)
      rows.push({
        videoId: video(ENTRY_VIDEOS + STREAMED_SONGS + n),
        recordingKey: "",
        plays: 1,
        countedPlays: 1,
        listenedMs: 60_000,
        countedListenedMs: 60_000,
        lastPlayedAt: n,
      });
    db.insert(schema.streamedTotals).values(rows).run();
  }
  return db;
};

const db = await seed();
const reads: readonly [string, (d: LibraryDatabase) => unknown, number][] = [
  ["read Home's mix playlist entries", (d) => mixPlaylisted(d), ENTRIES],
  ["read the videos the owner knows", (d) => selectKnownVideos(d), KNOWN],
  ["read Home's playlist seed ids", (d) => selectPlaylistEntryVideoIds(d), ENTRY_VIDEOS],
];
for (const [, read, rows] of reads)
  assert.equal((read(db) as unknown[]).length, rows, "the seed has the phone's row counts");

// Every replay step (a pass, or a step of mapping rows) is timed, as the app's block log names it.
let steps: number[] = [];
offThread.runReplayPassesWith((run) => {
  const start = performance.now();
  try {
    return run();
  } finally {
    steps.push(performance.now() - start);
  }
});

const connection = offThread.readConnections(async () => asyncReadClient(db));
const now = () => performance.now();
// One share for every caller, as the Library store keeps.
const replay = offThread.sharedReplays(connection, now);

/** [read] with its passes counted (each pass runs it from the top). */
const counted = (read: (d: LibraryDatabase) => unknown) => {
  const counter = { passes: 0, read: (d: LibraryDatabase) => (counter.passes++, read(d)) };
  return counter;
};

const round = (ms: number) => Number(ms.toFixed(1));

printMeta({ runs, entries: ENTRIES, knownVideos: KNOWN });
for (const [operation, read] of reads) {
  const first: number[] = [];
  const again: number[] = [];
  const burst: number[] = [];
  const longest: number[] = [];
  let passes = { first: 0, again: 0, burst: 0 };
  for (let run = 0; run < runs; run++) {
    // A new function each run: the first time this read runs.
    const fresh = counted((d) => read(d));
    steps = [];
    first.push((await replay(fresh.read)).heldMs);
    const firstPasses = fresh.passes;
    fresh.passes = 0;
    again.push((await replay(fresh.read)).heldMs);
    const againPasses = fresh.passes;
    fresh.passes = 0;
    const three = await Promise.all([replay(fresh.read), replay(fresh.read), replay(fresh.read)]);
    burst.push(three.reduce((sum, { heldMs }) => sum + heldMs, 0));
    longest.push(Math.max(...steps));
    passes = { first: firstPasses, again: againPasses, burst: fresh.passes };
  }
  console.log(
    JSON.stringify({
      kind: "read",
      operation,
      firstMs: round(median(first)),
      againMs: round(median(again)),
      threeAtOnceMs: round(median(burst)),
      longestStepMs: round(median(longest)),
      passes,
    }),
  );
}
