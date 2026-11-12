import assert from "node:assert/strict";
import { test } from "node:test";
import {
  albumDownloadOrigin,
  indexListDownloads,
  unsearchedSongJob,
  type YtDownloadJournalJob,
} from "@wave/core";
import { eq } from "drizzle-orm";
import {
  addToPlaylist,
  createPlaylist,
  removePlaylistItems,
  selectPlaylistEntries,
} from "./playlists.ts";
import { selectListDownloadMembers } from "./listDownloadMembers.ts";
import { tracks } from "./schema.ts";
import {
  openTestDatabase,
  addTrack,
  traceQueries,
  migrateTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

const albumOf = (db: TestDatabase, trackId: number): { albumId: number; path: string } => {
  const row = db
    .select({ albumId: tracks.albumId, path: tracks.path })
    .from(tracks)
    .where(eq(tracks.id, trackId))
    .get();
  assert.ok(row !== undefined && row.path !== null);
  return { albumId: row.albumId, path: row.path };
};

const song = (videoId: string) => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
});

test("unsearched jobs keep counting after their search fails, and removed entries leave the count", async () => {
  const db = await openTestDatabase();
  const listed = {
    title: "Listed",
    artists: ["Artist"],
    album: "Album",
    durationMs: 180000,
    artworkUrl: null,
  };
  const missing = { ...listed, title: "Failed search", reason: "notFound" as const };
  const id = createPlaylist(
    db,
    "Import",
    [
      { source: "unsearched", song: listed },
      { source: "unavailable", song: missing },
      { source: "unsearched", song: { ...listed, album: "Different album" } },
    ],
    1,
  ).playlistId;
  const active = unsearchedSongJob(listed);
  const failed = unsearchedSongJob(missing);
  const index = indexListDownloads([
    job(active.videoId, { song: active }),
    job(failed.videoId, { song: failed, phase: "failed" }),
  ]);
  const { result, queries } = traceQueries(db, () => selectListDownloadMembers(db, index));
  assert.equal(index.line(result.get(`playlist:${id}`) ?? []), "Downloading · 0 of 2");
  assert.ok(
    queries.some((query) =>
      query.plan.some((step) => step.includes("playlist_items_listed_title_idx")),
    ),
    JSON.stringify(queries),
  );
  const entries = selectPlaylistEntries(db, id);
  removePlaylistItems(db, id, [entries[0]!.itemId], 2);
  assert.equal(index.line(selectListDownloadMembers(db, index).get(`playlist:${id}`) ?? []), null);
});

test("a journal song is read through indexes among thousands of unrelated playlist entries", async () => {
  const db = await openTestDatabase();
  const id = createPlaylist(
    db,
    "Large",
    Array.from({ length: 2000 }, (_, i) => ({ source: "stream" as const, song: song(String(i)) })),
    1,
  ).playlistId;
  const index = indexListDownloads([job("10")]);
  const { result, queries } = traceQueries(db, () => selectListDownloadMembers(db, index));
  assert.equal(index.line(result.get(`playlist:${id}`) ?? []), "Downloading · 0 of 1");
  assert.equal(
    queries.reduce((count, query) => count + query.rows, 0),
    1,
  );
  assert.ok(
    queries.some((query) => query.plan.some((step) => step.includes("playlist_items_video_idx"))),
    JSON.stringify(queries),
  );
});
const job = (id: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id,
  song: song(id),
  phase: "queued",
  ...patch,
});

test("download membership finds every playlist holding a journal song or saved file without opening it", async () => {
  const db = await openTestDatabase();
  const trackId = addTrack(db, { title: "Saved", album: "Album" });
  const first = createPlaylist(db, "First", [], 1).playlistId;
  const second = createPlaylist(db, "Second", [], 1).playlistId;
  addToPlaylist(
    db,
    first,
    [
      { source: "stream", song: song("a") },
      { source: "library", trackId },
    ],
    2,
  );
  addToPlaylist(
    db,
    second,
    [
      { source: "stream", song: song("a") },
      { source: "stream", song: song("b") },
    ],
    2,
  );
  const index = indexListDownloads([
    job("a"),
    job("saved", {
      phase: "completed",
      acknowledged: true,
      saved: { path: "/Music/Album/Saved.mp3" },
    }),
  ]);
  const rows = selectListDownloadMembers(db, index);
  assert.equal(index.line(rows.get(`playlist:${first}`) ?? []), "Downloading · 1 of 2");
  assert.equal(index.line(rows.get(`playlist:${second}`) ?? []), "Downloading · 0 of 1");
  const empty = traceQueries(db, () => selectListDownloadMembers(db, indexListDownloads([])));
  assert.equal(empty.queries.length, 0);
});

test("upgrading an existing Library adds the membership index and preserves playlist entries", async () => {
  const db = await openTestDatabase({ through: "0058_loudness_measurements" });
  const listed = { ...song("listed"), videoId: undefined };
  const id = createPlaylist(
    db,
    "Kept",
    [
      { source: "stream", song: song("a") },
      { source: "unsearched", song: listed },
    ],
    1,
  ).playlistId;
  await migrateTestDatabase(db);
  assert.equal(selectPlaylistEntries(db, id).length, 2);
  const pending = unsearchedSongJob(listed);
  const index = indexListDownloads([job("a"), job(pending.videoId, { song: pending })]);
  assert.equal(
    index.line(selectListDownloadMembers(db, index).get(`playlist:${id}`) ?? []),
    "Downloading · 0 of 2",
  );
});

test("an album downloading from YouTube Music is found once its first song is saved, beside the other albums", async () => {
  const db = await openTestDatabase();
  const saved = addTrack(db, { title: "Saved", album: "One" });
  const other = addTrack(db, { title: "Other", album: "Two" });
  const { albumId, path } = albumOf(db, saved);
  const origin = { kind: "album", id: "MPREb_one", name: "One" } as const;
  const index = indexListDownloads([
    job("saved", { origin, phase: "completed", acknowledged: true, saved: { path } }),
    job("a", { origin }),
    job("b", { origin, phase: "failed" }),
    job("c", { origin: albumDownloadOrigin({ id: albumOf(db, other).albumId, title: "Two" }) }),
  ]);
  const { result, queries } = traceQueries(db, () => selectListDownloadMembers(db, index));
  assert.equal(index.line(result.get(`album:${albumId}`) ?? []), "Downloading · 1 of 3");
  assert.equal(
    index.line(result.get(`album:${albumOf(db, other).albumId}`) ?? []),
    "Downloading · 0 of 1",
  );
  // One read by path for every album, whatever the Library's size.
  const byPath = queries.filter((query) => query.sql.includes("album_id"));
  assert.equal(byPath.length, 1, JSON.stringify(queries));
  assert.ok(
    byPath[0]!.plan.every((step) => !step.includes("SCAN")),
    JSON.stringify(byPath),
  );
});
