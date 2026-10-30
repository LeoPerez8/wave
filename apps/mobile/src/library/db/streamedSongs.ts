/**
 * The streamed songs rankings show, from their plays: each video's song as the
 * queue had it when its latest play started. Kept free of Expo so the store
 * tests run it against a real SQLite (`testDatabase.ts`).
 */
import type { PlaySnapshot, YtAlbumSong } from "@wave/core";
import { and, isNotNull, max, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import { playEvents } from "./schema.ts";

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
  // One read for all the videos: grouped with a single max(), SQLite takes
  // the kept column from the row with the latest start.
  const durations = new Map<string | null, number | null>();
  const latest = <K>(
    ids: readonly string[],
    kept: typeof playEvents.streamedSong | typeof playEvents.snapshot,
  ) =>
    new Map(
      db
        .select({
          videoId: playEvents.videoId,
          kept,
          durationMs: playEvents.durationMs,
          startedAt: max(playEvents.startedAt),
        })
        .from(playEvents)
        .where(
          and(
            sql`${playEvents.videoId} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
            isNotNull(kept),
          ),
        )
        .groupBy(playEvents.videoId)
        .all()
        .map((row) => {
          durations.set(row.videoId, row.durationMs);
          return [row.videoId, row.kept as K | null] as const;
        }),
    );
  const kept = latest<YtAlbumSong>(wanted, playEvents.streamedSong);
  const unkept = wanted.filter((videoId) => kept.get(videoId) == null);
  const snapshots =
    unkept.length === 0 ? new Map() : latest<PlaySnapshot>(unkept, playEvents.snapshot);
  const songs = new Map<string, YtAlbumSong>();
  for (const videoId of wanted) {
    const song = kept.get(videoId);
    if (song != null) {
      songs.set(videoId, song);
      continue;
    }
    const snapshot = snapshots.get(videoId);
    if (snapshot != null)
      songs.set(videoId, {
        videoId,
        title: snapshot.title,
        artists: snapshot.artist === "" ? [] : [snapshot.artist],
        album: snapshot.album,
        durationMs: durations.get(videoId) ?? null,
        artworkUrl: snapshot.artworkUrl ?? null,
        explicit: false,
        albumId: null,
      });
  }
  return songs;
};
