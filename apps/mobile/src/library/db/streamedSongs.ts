/**
 * The streamed songs rankings show, from their plays: each video's song as the
 * queue had it when its latest play started. Kept free of Expo so the store
 * tests run it against a real SQLite (`testDatabase.ts`).
 */
import type { YtAlbumSong } from "@wave/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";

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
  const songs = new Map<string, YtAlbumSong>();
  const latest = (
    videoId: string,
    kept: typeof playEvents.streamedSong | typeof playEvents.snapshot,
  ) =>
    db
      .select({ song: playEvents.streamedSong, snapshot: playEvents.snapshot })
      .from(playEvents)
      .where(and(eq(playEvents.videoId, videoId), isNotNull(kept)))
      .orderBy(desc(playEvents.startedAt))
      .limit(1)
      .get();
  for (const videoId of new Set(videoIds)) {
    const song = latest(videoId, playEvents.streamedSong)?.song;
    if (song != null) {
      songs.set(videoId, song);
      continue;
    }
    const snapshot = latest(videoId, playEvents.snapshot)?.snapshot;
    if (snapshot != null)
      songs.set(videoId, {
        videoId,
        title: snapshot.title,
        artists: snapshot.artist === "" ? [] : [snapshot.artist],
        album: snapshot.album,
        durationMs: null,
        artworkUrl: snapshot.artworkUrl ?? null,
        explicit: false,
        albumId: null,
      });
  }
  return songs;
};
