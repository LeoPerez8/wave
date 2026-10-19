/**
 * What Core's taste profile (`tasteProfile`) is derived from: the play
 * history, the favorites and the downloads, as the library database keeps
 * them. Kept free of Expo so the store tests run it in plain Node;
 * `LibraryStore` calls it.
 */
import type { TasteHistory } from "@wave/core";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/**
 * Every play of a song still in the Library (one gone has no artist or
 * genre left to weigh), every song starred with when its star changed, and
 * every song downloaded from YouTube Music, dated by its file: when it
 * entered the Library, or the file's own date when that's older (a Library
 * scanned afresh), so editing its tags later doesn't make it new.
 */
export const tasteHistory = (db: LibraryDatabase): TasteHistory => {
  const { playEvents, favorites, tracks } = schema;
  const plays = db
    .select({
      trackId: playEvents.trackId,
      startedAt: playEvents.startedAt,
      listenedMs: playEvents.listenedMs,
      endReason: playEvents.endReason,
    })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .orderBy(playEvents.startedAt, playEvents.id)
    .all()
    .map((play) => ({ ...play, trackId: String(play.trackId) }));
  const starred = db
    .select({ trackId: favorites.trackId, changedAt: favorites.changedAt })
    .from(favorites)
    .where(eq(favorites.deleted, false))
    .all()
    .map((star) => ({ ...star, trackId: String(star.trackId) }));
  const downloads = db
    .select({
      trackId: tracks.id,
      downloadedAt: sql<number>`min(${tracks.addedAt}, ${tracks.modifiedAt})`,
    })
    .from(tracks)
    .where(and(isNotNull(tracks.videoId), isNotNull(tracks.path)))
    .orderBy(tracks.id)
    .all()
    .map((download) => ({ ...download, trackId: String(download.trackId) }));
  return { plays, favorites: starred, downloads };
};
