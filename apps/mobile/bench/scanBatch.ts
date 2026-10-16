/**
 * A scan's JavaScript work (#315): one scanner batch of new files saved in
 * one transaction (as before) against the same files saved in slices of
 * `SCAN_SAVE_SLICE` (one per free turn now), the startup scan's first read
 * (`selectKnownFiles`, every indexed file), and the whole-Library link a
 * scan's end ran every time (`linkPlaylistEntries`) against the revision
 * read that now decides whether it runs. Prints each step's median time; for
 * the save, also the longest single block, which is what a tap waits behind.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite or Hermes. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/scanBatch.ts [--quick]
 */
import {
  SCAN_SAVE_SLICE,
  normalizeTrack,
  reconcileScan,
  scanSaveSlices,
  type PlaylistSong,
} from "@wave/core";
import { performance } from "node:perf_hooks";

import type { IndexedTrack } from "../src/library/LibraryStore.ts";
import { creditSplits } from "../src/library/db/credits.ts";
import {
  addToPlaylist,
  linkPlaylistEntries,
  selectPlaylistEntriesRevision,
} from "../src/library/db/playlists.ts";
import { saveBatch } from "../src/library/db/save.ts";
import * as schema from "../src/library/db/schema.ts";
import { openTestDatabase } from "../src/library/db/testDatabase.ts";
import { selectKnownFiles } from "../src/library/db/tracks.ts";

const quick = process.argv.includes("--quick");
/** The Library already indexed. */
const LIBRARY = quick ? 1_000 : 6_000;
/** The scanner's batch (`LibraryScanner.batchSize`). */
const BATCH = 500;
/** Streamed entries in playlists, which the end-of-scan link decodes. */
const STREAMED = quick ? 500 : 2_500;
const RUNS = quick ? 3 : 5;
const ROOT = "/storage/emulated/0/Music";

const splits = creditSplits();
let nextFile = 0;
/** A new file as the scanner reads it. */
const file = (): IndexedTrack => {
  const n = nextFile++;
  return {
    ...normalizeTrack({
      path: `${ROOT}/Artist ${n % 300}/Album ${n % 900}/${n} Song ${n}.flac`,
      title: `Song ${n}`,
      artist: `Artist ${n % 300}`,
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
  };
};
const files = (count: number): IndexedTrack[] => Array.from({ length: count }, file);

const median = (samples: readonly number[]): number => {
  const sorted = samples.toSorted((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(2));
};
const time = (run: () => unknown): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

const db = await openTestDatabase();
for (let i = 0; i < LIBRARY; i += BATCH) {
  saveBatch(db, splits, files(Math.min(BATCH, LIBRARY - i)), [], [], 0, { linkEntries: false });
}
const playlist = db
  .insert(schema.playlists)
  .values({ name: "Streamed", createdAt: 0, updatedAt: 0, changedAt: 0 })
  .returning()
  .get().id;
const streamed: PlaylistSong[] = Array.from({ length: STREAMED }, (_, i) => ({
  source: "stream",
  song: {
    videoId: `v${i.toString(36).padStart(10, "0")}`,
    title: `Streamed ${i}`,
    artists: ["Nobody Here"],
    album: "Elsewhere",
    albumId: "MPREb_x",
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
}));
addToPlaylist(db, playlist, streamed, 1);

const whole: number[] = [];
const sliced: number[] = [];
const slicedLongest: number[] = [];
for (let run = 0; run < RUNS; run++) {
  const batch = reconcileScan({ missing: [], read: files(BATCH), isIndexed: () => false });
  whole.push(
    time(() =>
      saveBatch(db, splits, [...batch.added], [], [], 0, {
        linkEntries: false,
      }),
    ),
  );
  const next = reconcileScan({ missing: [], read: files(BATCH), isIndexed: () => false });
  const blocks = scanSaveSlices(next).map((slice) =>
    time(() => saveBatch(db, splits, slice.tracks, [], slice.moves, 0, { linkEntries: false })),
  );
  sliced.push(blocks.reduce((sum, ms) => sum + ms, 0));
  slicedLongest.push(Math.max(...blocks));
}

const indexed = LIBRARY + RUNS * 2 * BATCH;
const known = Array.from({ length: RUNS }, () => time(() => selectKnownFiles(db, [ROOT])));
const link = Array.from({ length: RUNS }, () => time(() => linkPlaylistEntries(db, 0)));
const revision = Array.from({ length: RUNS }, () => time(() => selectPlaylistEntriesRevision(db)));

console.log(
  `Desktop (sql.js), Library ${LIBRARY} → ${indexed} files, ${STREAMED} streamed entries, ${RUNS} runs, medians:`,
);
console.log(`| Step | ms |`);
console.log(`| --- | ---: |`);
console.log(`| ${BATCH} new files, one transaction (before) | ${median(whole)} |`);
console.log(`| ${BATCH} new files in slices of ${SCAN_SAVE_SLICE}, total | ${median(sliced)} |`);
console.log(`| … the longest slice (a tap waits at most this) | ${median(slicedLongest)} |`);
console.log(`| Startup scan's first read, every indexed file | ${median(known)} |`);
console.log(`| Scan end: link over the whole Library (every rescan before) | ${median(link)} |`);
console.log(`| Scan end: entries' revision (decides the link now) | ${median(revision)} |`);
