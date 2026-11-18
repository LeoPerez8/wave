/**
 * What Core's taste profile (`tasteProfile`) is derived from: the play
 * history, the favorites and the downloads, as the library database keeps
 * them. Kept free of Expo so the store tests run it in plain Node;
 * `LibraryStore` calls it.
 */
import { ytTrackId, type TasteHistory } from "@wave/core";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { tasteSong } from "./tastePages.ts";

/**
 * Every play of a song still in the Library (one gone has no artist or
 * genre left to weigh) or streamed (`tasteSong`), every song starred with when its star changed, and
 * every song downloaded from YouTube Music, dated by its file: when it
 * entered the Library, or the file's own date when that's older (a Library
 * scanned afresh), so editing its tags later doesn't make it new.
 */
export const tasteHistory = (db: LibraryDatabase): TasteHistory => {
  const { favorites, tracks } = schema;
  const plays = db
    .all<{
      song: number | null;
      videoId: string | null;
      startedAt: number;
      listenedMs: number;
      endReason: TasteHistory["plays"][number]["endReason"];
    }>(
      sql`SELECT ${tasteSong} AS song, pe.video_id AS "videoId", pe.started_at AS "startedAt",
        pe.listened_ms AS "listenedMs", pe.end_reason AS "endReason"
      FROM play_events pe ORDER BY pe.started_at, pe.id`,
    )
    .flatMap(({ song, videoId, ...play }) =>
      song !== null
        ? [{ trackId: String(song), ...play }]
        : videoId !== null
          ? [{ trackId: ytTrackId(videoId), ...play }]
          : [],
    );
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
