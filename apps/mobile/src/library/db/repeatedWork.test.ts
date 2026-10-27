import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { SONG_SORTS, ytDownloadsToForget, type YtDownloadJournalJob } from "@wave/core";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import {
  addLibrary,
  addTrack,
  addMissingSong,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "./testDatabase.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const job = (id: string, title = "Moved"): YtDownloadJournalJob => ({
  id,
  song: {
    videoId: id,
    title,
    artists: ["Artist"],
    album: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  },
  phase: "completed",
  acknowledged: true,
  saved: { path: `/old/${id}.m4a` },
});

test("download recovery reads only matching files, including moved songs and aliases", async () => {
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: 1000, artists: 40, albums: 100 });
    addTrack(db, { title: "Moved", artist: "Artist" });
    const missing = addMissingSong(db, { title: "Absent", artist: "Artist" });
    const store = await loadLibraryStore(root, db);
    const jobs = [
      job("moved"),
      job("gone", "Deleted"),
      job(`missing:${missing}`, "Absent"),
      { ...job("alias", "Wrong"), aliases: [job("alias").song] },
    ];
    const expected = ytDownloadsToForget(jobs, Effect.runSync(store.listSongs));
    const measured = traceQueries(db, () => Effect.runSync(store.downloadsToForget(jobs)));
    assert.deepEqual(measured.result, expected);
    assert.deepEqual(measured.result, ["gone", `missing:${missing}`]);
    assert.ok(measured.queries.reduce((sum, q) => sum + q.rows, 0) < 10);
    assert.ok(
      measured.queries.some((q) => q.plan.some((p) => p.includes("tracks_match_title_idx"))),
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("Queue section songs use the Songs tab SQL order for every saved sort", async () => {
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: 90, artists: 6, albums: 9 });
    addMissingSong(db, { title: "Écho", artist: "The Artist", album: "The Album" });
    addTrack(db, { title: "Echo", artist: "Artist", album: "Album" });
    const store = await loadLibraryStore(root, db);
    for (const sort of SONG_SORTS) {
      const expected = Effect.runSync(store.listSongOrder(sort)).ids;
      const measured = traceQueries(db, () => Effect.runSync(store.listSortedSongs(sort)));
      assert.deepEqual(
        measured.result.map((song) => song.id),
        expected,
        JSON.stringify(sort),
      );
      assert.equal(measured.queries.length, 1);
      assert.match(measured.queries[0]!.sql, /order by/i);
    }
  } finally {
    closeTestDatabase(db);
  }
});
