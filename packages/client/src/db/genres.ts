/**
 * The songs of a genre (its screen and its long-press menu). Kept free of
 * Expo so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import { eq } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { BY_TITLE, trackQuery } from "./tracks.ts";

/** A genre's songs by title, the genre screen's order. */
export const selectGenreSongs = (db: LibraryDatabase, genreId: number) =>
  trackQuery(db)
    .where(eq(schema.tracks.genreId, genreId))
    .orderBy(...BY_TITLE)
    .all();
