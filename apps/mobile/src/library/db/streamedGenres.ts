/** Phone-local Deezer answers, including permanent misses, keyed by video id. */
import { and, eq, gt, inArray, isNotNull, isNull, asc } from "drizzle-orm";
import type { RecapSongGenre } from "@wave/core";
import type { LibraryDatabase } from "./database.ts";
import { playEvents, streamedGenres } from "./schema.ts";
import { chunks } from "./chunks.ts";

/** Bounded keyset page of videos in history that have never received an answer. */
export const pendingStreamedGenres = (db: LibraryDatabase, after: string, limit = 32): string[] =>
  db
    .selectDistinct({ videoId: playEvents.videoId })
    .from(playEvents)
    .leftJoin(streamedGenres, eq(streamedGenres.videoId, playEvents.videoId))
    .where(
      and(
        isNotNull(playEvents.videoId),
        eq(playEvents.counted, true),
        isNull(streamedGenres.videoId),
        gt(playEvents.videoId, after),
      ),
    )
    .orderBy(asc(playEvents.videoId))
    .limit(limit)
    .all()
    .map((row) => row.videoId!);

export const keepStreamedGenre = (
  db: LibraryDatabase,
  videoId: string,
  genre: string | null,
): void => {
  db.insert(streamedGenres).values({ videoId, genre }).onConflictDoNothing().run();
};

export const streamedSongGenres = (
  db: LibraryDatabase,
  videoIds: readonly string[],
): RecapSongGenre[] =>
  chunks(videoIds).flatMap((ids) =>
    db
      .select({ id: streamedGenres.videoId, genre: streamedGenres.genre })
      .from(streamedGenres)
      .where(inArray(streamedGenres.videoId, ids))
      .all(),
  );
