/**
 * Lyrics saved for non-D songs (`schema.savedLyrics`, Core's `SavedLyrics`):
 * what the Lyrics view found online for a song this phone has no file for,
 * or that it found none, by the song's YouTube video. Kept free of Expo for
 * the store tests.
 */
import type { SavedLyrics } from "@wave/core";
import { eq, inArray } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 200;

/** What is saved for [videoId], or null for nothing. */
export const selectSavedLyrics = (db: LibraryDatabase, videoId: string): SavedLyrics | null => {
  const t = schema.savedLyrics;
  const row = db.select().from(t).where(eq(t.videoId, videoId)).get();
  if (row === undefined) return null;
  return row.lyrics === null
    ? { kind: "miss", checkedAt: row.checkedAt }
    : { kind: "found", lyrics: { synced: row.synced, text: row.lyrics } };
};

/**
 * Saves [saved] for [videoId], replacing what was saved before. Found lyrics
 * are checked as of [now]; a miss keeps its own time.
 */
export const keepSavedLyrics = (
  db: LibraryDatabase,
  videoId: string,
  saved: SavedLyrics,
  now: number = Date.now(),
): void => {
  const row =
    saved.kind === "found"
      ? { lyrics: saved.lyrics.text, synced: saved.lyrics.synced, checkedAt: now }
      : { lyrics: null, synced: false, checkedAt: saved.checkedAt };
  db.insert(schema.savedLyrics)
    .values({ videoId, ...row })
    .onConflictDoUpdate({ target: schema.savedLyrics.videoId, set: row })
    .run();
};

/** Drops what is saved for [videoIds]: a download put their lyrics in a file. */
export const forgetSavedLyrics = (db: LibraryDatabase, videoIds: readonly string[]): void => {
  const t = schema.savedLyrics;
  for (let start = 0; start < videoIds.length; start += BATCH) {
    db.delete(t)
      .where(inArray(t.videoId, videoIds.slice(start, start + BATCH)))
      .run();
  }
};
