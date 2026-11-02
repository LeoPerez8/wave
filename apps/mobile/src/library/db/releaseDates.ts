import { and, eq, isNull } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
/**
 * A tag or owner date always wins, including one saved while the request was running. Returns
 * the song's file (null for a missing song) when the date went in, so it's written there once;
 * null when the song had a date or is gone.
 */
export const saveReleaseDate = (
  db: LibraryDatabase,
  id: number,
  date: string,
): { readonly path: string | null } | null =>
  db
    .update(tracks)
    .set({ releaseDate: date })
    .where(and(eq(tracks.id, id), isNull(tracks.releaseDate)))
    .returning({ path: tracks.path })
    .get() ?? null;

/**
 * Keeps the owner's typed [date] as the song's, whatever it had (null clears it, so the lookup
 * can find one again). Returns the song's file (null for a missing song) for the date to be
 * written there too; null when the song is gone.
 */
export const saveTypedReleaseDate = (
  db: LibraryDatabase,
  id: number,
  date: string | null,
): { readonly path: string | null } | null =>
  db
    .update(tracks)
    .set({ releaseDate: date })
    .where(eq(tracks.id, id))
    .returning({ path: tracks.path })
    .get() ?? null;
