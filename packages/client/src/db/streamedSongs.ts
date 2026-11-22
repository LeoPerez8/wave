/**
 * The streamed songs rankings show, from their plays: each video's song as the
 * queue had it when its latest play started. Kept free of Expo so the store
 * tests run it against a real SQLite (`testDatabase.ts`).
 */
import type { PlaySnapshot, YtAlbumSong } from "@wave/core";
import { and, isNotNull, max, sql, type SQL } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import { playEvents } from "./schema.ts";

/**
 * Each video [videos] selects (a statement of one column) with its latest play
 * that kept [kept], and that play's duration. One read for all the videos:
 * grouped with a single max(), SQLite takes the kept column from the row with
 * the latest start.
 */
const latestKept = <K>(
  db: LibraryDatabase,
  videos: SQL,
  kept: typeof playEvents.streamedSong | typeof playEvents.snapshot,
): LatestKept<K>[] =>
  db
    .select({
      videoId: playEvents.videoId,
      kept,
      durationMs: playEvents.durationMs,
      startedAt: max(playEvents.startedAt),
    })
    .from(playEvents)
    .where(and(sql`${playEvents.videoId} IN (${videos})`, isNotNull(kept)))
    .groupBy(playEvents.videoId)
    .all() as LatestKept<K>[];

interface LatestKept<K> {
  readonly videoId: string | null;
  readonly kept: K | null;
  readonly durationMs: number | null;
}

/** A video's song from its latest play's [snapshot], with that play's [durationMs]. */
const snapshotSong = (
  videoId: string,
  snapshot: PlaySnapshot,
  durationMs: number | null,
): YtAlbumSong => ({
  videoId,
  title: snapshot.title,
  artists: snapshot.artist === "" ? [] : [snapshot.artist],
  album: snapshot.album,
  durationMs,
  artworkUrl: snapshot.artworkUrl ?? null,
  explicit: false,
  albumId: null,
});

/**
 * The song of each of [videoIds] from its latest play that kept one, by video
 * id; a video whose plays kept only their snapshot (from another phone) is
 * made from that. A video never streamed here is left out.
 */
export const streamedSongsOf = (
  db: LibraryDatabase,
  videoIds: readonly string[],
): Map<string, YtAlbumSong> => {
  const wanted = [...new Set(videoIds)];
  if (wanted.length === 0) return new Map();
  const ids = (list: readonly string[]) =>
    sql`SELECT value FROM json_each(${JSON.stringify(list)})`;
  const durations = new Map<string | null, number | null>();
  const latest = <K>(rows: readonly LatestKept<K>[]) =>
    new Map(
      rows.map((row) => {
        durations.set(row.videoId, row.durationMs);
        return [row.videoId, row.kept] as const;
      }),
    );
  const kept = latest(latestKept<YtAlbumSong>(db, ids(wanted), playEvents.streamedSong));
  const unkept = wanted.filter((videoId) => kept.get(videoId) == null);
  const snapshots =
    unkept.length === 0
      ? new Map<string | null, PlaySnapshot | null>()
      : latest(latestKept<PlaySnapshot>(db, ids(unkept), playEvents.snapshot));
  const songs = new Map<string, YtAlbumSong>();
  for (const videoId of wanted) {
    const song = kept.get(videoId);
    if (song != null) {
      songs.set(videoId, song);
      continue;
    }
    const snapshot = snapshots.get(videoId);
    if (snapshot != null)
      songs.set(videoId, snapshotSong(videoId, snapshot, durations.get(videoId) ?? null));
  }
  return songs;
};

/**
 * What `streamedSongsOf` reads for the videos [videos] selects (a statement of
 * one `videoId` column), statements only: each video's latest kept song and
 * latest snapshot, however many videos. `streamedSongsSteps` works them out.
 */
export const streamedSongRows = (db: LibraryDatabase, videos: SQL) => ({
  kept: latestKept<YtAlbumSong>(db, videos, playEvents.streamedSong),
  snapshots: latestKept<PlaySnapshot>(db, videos, playEvents.snapshot),
});

/** What `streamedSongRows` read. */
export type StreamedSongRows = ReturnType<typeof streamedSongRows>;

/**
 * `streamedSongsOf` for each of [wanted]'s videos from [rows], read for them
 * (`streamedSongRows`): a row or a wanted video per step. [rows] is left as it is.
 */
export function* streamedSongsSteps(
  wanted: readonly { readonly videoId: string }[],
  rows: StreamedSongRows,
): Generator<void, Map<string, YtAlbumSong>> {
  const kept = new Map<string | null, YtAlbumSong | null>();
  for (const row of rows.kept) {
    kept.set(row.videoId, row.kept);
    yield;
  }
  const snapshots = new Map<string | null, LatestKept<PlaySnapshot>>();
  for (const row of rows.snapshots) {
    snapshots.set(row.videoId, row);
    yield;
  }
  const songs = new Map<string, YtAlbumSong>();
  for (const { videoId } of wanted) {
    yield;
    if (songs.has(videoId)) continue;
    const song = kept.get(videoId);
    if (song != null) {
      songs.set(videoId, song);
      continue;
    }
    const snapshot = snapshots.get(videoId);
    if (snapshot?.kept != null)
      songs.set(videoId, snapshotSong(videoId, snapshot.kept, snapshot.durationMs ?? null));
  }
  return songs;
}
