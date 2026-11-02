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
