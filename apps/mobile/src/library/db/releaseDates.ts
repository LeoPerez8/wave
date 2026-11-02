import { and, eq, isNull } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
/** A tag or owner date always wins, including one saved while the request was running. */
export const saveReleaseDate = (db: LibraryDatabase, id: number, date: string): void => {
  db.update(tracks)
    .set({ releaseDate: date })
    .where(and(eq(tracks.id, id), isNull(tracks.releaseDate)))
    .run();
};
