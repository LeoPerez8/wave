/**
 * A Library song's online lyrics search (Core's `libraryLyrics`): what it
 * goes by, and when it last found nothing (`schema.lyricsMisses`). Kept free
 * of Expo for the store tests.
 */
import type { LibraryLyricsTrack } from "@wave/core";
import { eq } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** What a Library song's lyrics search goes by, and when it last found nothing (null: never). */
export interface LyricsSearchTrack extends LibraryLyricsTrack {
  readonly missedAt: number | null;
}

/** What the lyrics search for the track [trackId] goes by, or null for no such track. */
export const selectLyricsSearchTrack = (
  db: LibraryDatabase,
  trackId: number,
): LyricsSearchTrack | null => {
  const { tracks, albums, lyricsMisses } = schema;
  return (
    db
      .select({
        title: tracks.title,
        artist: tracks.artistCredit,
        album: albums.title,
        durationMs: tracks.durationMs,
        videoId: tracks.videoId,
        missedAt: lyricsMisses.checkedAt,
      })
      .from(tracks)
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .leftJoin(lyricsMisses, eq(lyricsMisses.trackId, tracks.id))
      .where(eq(tracks.id, trackId))
      .get() ?? null
  );
};

/** Remembers that the search for [trackId] found nothing at [checkedAt]; null forgets it. */
export const keepLyricsMiss = (
  db: LibraryDatabase,
  trackId: number,
  checkedAt: number | null,
): void => {
  const t = schema.lyricsMisses;
  if (checkedAt === null) {
    db.delete(t).where(eq(t.trackId, trackId)).run();
    return;
  }
  db.insert(t)
    .values({ trackId, checkedAt })
    .onConflictDoUpdate({ target: t.trackId, set: { checkedAt } })
    .run();
};
