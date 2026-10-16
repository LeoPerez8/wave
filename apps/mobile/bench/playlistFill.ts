/**
 * An import filling a playlist (#308) while other large playlists exist: per
 * batch given, the append (`addToPlaylist`), then the reads that follow it
 * while Library › Playlists (`selectPlaylists`) or the filling playlist's
 * page (`selectPlaylist`) is in sight. Prints, at a few sizes of the filling
 * playlist, each step's median time, the statements it ran, the rows they
 * returned and the stored YT Music songs it decoded in JavaScript
 * (`JSON.parse` calls).
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite or Hermes. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/playlistFill.ts [--quick] [--db <dir>]
 *
 * `--db` runs it against another copy of `src/library/db` (an older commit's,
 * e.g. from `git archive <commit> apps/mobile/src/library/db`), placed under
 * `apps/mobile` so its imports resolve.
 */
import type { PlaylistSong, YtAlbumSong } from "@wave/core";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import type * as Playlists from "../src/library/db/playlists.ts";
import type * as Schema from "../src/library/db/schema.ts";
import type * as Fixtures from "../src/library/db/testDatabase.ts";
import { median, printMeta } from "./measure.ts";

const dbFlag = process.argv.indexOf("--db");
const dbDir =
  dbFlag < 0
    ? new URL("../src/library/db/", import.meta.url)
    : pathToFileURL(`${resolve(process.argv[dbFlag + 1] ?? "")}/`);
const load = <M>(file: string): Promise<M> => import(new URL(file, dbDir).href) as Promise<M>;
const {
  addToPlaylist,
  selectPlaylist,
  selectPlaylistCovers,
  selectPlaylists,
  selectPlaylistTotals,
} = await load<typeof Playlists>("playlists.ts");
const schema = await load<typeof Schema>("schema.ts");
const { addTrack, openTestDatabase, traceQueries } = await load<typeof Fixtures>("testDatabase.ts");
type TestDatabase = Fixtures.TestDatabase;

const quick = process.argv.includes("--quick");
const LIBRARY_TRACKS = quick ? 300 : 1_500;
/** The other playlists: streamed entries and Library entries each. */
const OTHERS = quick
  ? [{ streamed: 500, library: 0 }]
  : [
      { streamed: 2_500, library: 0 },
      { streamed: 2_500, library: 0 },
      { streamed: 500, library: 500 },
      { streamed: 0, library: 50 },
    ];
/** Sizes of the filling playlist at which each step is measured. */
const SIZES = quick ? [200, 600] : [500, 1_500, 3_000];
/** Songs per batch given: about a second of a Spotify import's answers. */
const BATCH = 20;
const RUNS = quick ? 3 : 7;

const db: TestDatabase = await openTestDatabase();

const trackIds: number[] = [];
for (let i = 0; i < LIBRARY_TRACKS; i++) {
  trackIds.push(
    addTrack(db, {
      title: `Track ${i}`,
      artist: `Artist ${i % 40}`,
      album: `Album ${i % 120}`,
      artworkHash: `art${i % 120}`,
    }),
  );
}

let nextVideo = 0;
const ytSong = (): YtAlbumSong => {
  const videoId = `v${(nextVideo++).toString(36).padStart(10, "0")}`;
  return {
    videoId,
    title: `Streamed song ${videoId}`,
    artists: ["Someone", "Someone Else"],
    album: "An Album",
    albumId: "MPREb_album",
    durationMs: 200_000 + (nextVideo % 60_000),
    artworkUrl: `https://lh3.googleusercontent.com/${videoId}=w544-h544`,
    explicit: false,
  };
};
const stream = (): PlaylistSong => ({ source: "stream", song: ytSong() });
const library = (index: number): PlaylistSong => ({
  source: "library",
  trackId: trackIds[index % trackIds.length]!,
});

const newPlaylist = (name: string): number =>
  db
    .insert(schema.playlists)
    .values({ name, createdAt: 0, updatedAt: 0, changedAt: 0 })
    .returning()
    .get().id;

OTHERS.forEach(({ streamed, library: libraryCount }, n) => {
  const id = newPlaylist(`Other ${n + 1}`);
  const songs = [
    ...Array.from({ length: streamed }, stream),
    ...Array.from({ length: libraryCount }, (_, i) => library(i * 7 + n)),
  ];
  addToPlaylist(db, id, songs, 1);
});
const filling = newPlaylist("Imported");

// Every stored YT Music song is decoded with JSON.parse (Core's `readPlaylistYtSong`).
let parses = 0;
const parse = JSON.parse;
JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
  parses++;
  return parse(...args);
}) as typeof JSON.parse;

let given = 0;
/** The next batch: mostly streamed songs, one in ten a Library song, one already in. */
const batch = (): PlaylistSong[] => {
  const songs: PlaylistSong[] = [];
  for (let i = 0; i < BATCH; i++) songs.push(i % 10 === 9 ? library(given + i) : stream());
  given += BATCH;
  return songs;
};
const giveBatch = (): void => {
  addToPlaylist(db, filling, batch(), 2);
};

/**
 * [step] once traced (statements, rows, decodes), then its median time over
 * RUNS, each after [between]. A first [step] runs before, as the screen in
 * sight read it a moment ago.
 */
const measure = (step: () => unknown, between: () => void = () => {}) => {
  step();
  between();
  const before = parses;
  const { queries } = traceQueries(db, step);
  const decoded = parses - before;
  const wall: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    between();
    const start = performance.now();
    step();
    wall.push(performance.now() - start);
  }
  return {
    ms: median(wall),
    statements: queries.length,
    rowsReturned: queries.reduce((sum, query) => sum + query.rows, 0),
    decoded,
  };
};

const size = (): number =>
  db.get<{ n: number }>(
    `SELECT count(*) AS n FROM playlist_items WHERE playlist_id = ${filling} AND NOT deleted`,
  )!.n;

printMeta({ runs: RUNS, libraryTracks: LIBRARY_TRACKS, others: OTHERS, batch: BATCH });

for (const target of SIZES) {
  while (size() < target) giveBatch();
  const at = size();
  // Each run gives a batch; the reads after it see the playlist just changed.
  const steps = {
    append: measure(giveBatch),
    listAfterAppend: measure(() => selectPlaylists(db), giveBatch),
    pageAfterAppend: measure(() => selectPlaylist(db, filling), giveBatch),
    listUnchanged: measure(() => selectPlaylists(db)),
    // What working the filling playlist's row out again costs, by part.
    coversOfFilling: measure(() => selectPlaylistCovers(db, filling)),
    totalsOfFilling: measure(() => selectPlaylistTotals(db, filling)),
  };
  for (const [step, result] of Object.entries(steps)) {
    console.log(JSON.stringify({ kind: "step", step, fillingSize: at, ...result }));
  }
}
