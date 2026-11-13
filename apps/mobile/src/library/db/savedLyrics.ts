/**
 * Lyrics saved for non-D songs (`schema.savedLyrics`, Core's `SavedLyrics`):
 * what the Lyrics view found online for a song this phone has no file for,
 * or that it found none, by the song's YouTube video. Kept free of Expo for
 * the store tests.
 */
import type { SavedLyrics } from "@wave/core";
import { and, asc, eq, gt, isNotNull, isNull, sql, inArray } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import {
  keepLyricsWords,
  selectLyricsWordCandidates,
  type LyricsWordIndex,
} from "./lyricsWordIndex.ts";
import * as schema from "./schema.ts";

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 200;

export interface SavedLyricsCandidate {
  readonly videoId: string;
  readonly lyrics: string;
}

const SAVED_LYRICS: LyricsWordIndex = {
  texts: "saved_lyrics_search_index",
  words: "saved_lyrics_search_words",
  key: "video_id",
};

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
  keepLyricsWords(db, SAVED_LYRICS, videoId, saved.kind === "found" ? saved.lyrics.text : null);
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

/** A bounded page of existing found lyrics whose Search index has not been built yet. */
export const selectSavedLyricsSearchIndexPage = (
  db: LibraryDatabase,
  afterVideoId: string,
  limit: number,
): SavedLyricsCandidate[] => {
  const saved = schema.savedLyrics;
  const index = schema.savedLyricsSearchIndex;
  return db
    .select({ videoId: saved.videoId, lyrics: saved.lyrics })
    .from(saved)
    .leftJoin(index, eq(index.videoId, saved.videoId))
    .where(
      and(
        gt(saved.videoId, afterVideoId),
        isNotNull(saved.lyrics),
        sql`trim(${saved.lyrics}) <> ''`,
        isNull(index.videoId),
      ),
    )
    .orderBy(asc(saved.videoId))
    .limit(limit)
    .all()
    .filter((row): row is SavedLyricsCandidate => row.lyrics !== null);
};

/** Indexes found lyrics that predate the saved-lyrics Search index migration. */
export const indexSavedLyrics = (db: LibraryDatabase, candidate: SavedLyricsCandidate): void =>
  keepLyricsWords(db, SAVED_LYRICS, candidate.videoId, candidate.lyrics);

/** Saved non-D lyrics whose indexed words hold [query]'s words in order (`selectLyricsWordCandidates`). */
export const selectSavedLyricsCandidates = (
  db: LibraryDatabase,
  query: string,
): SavedLyricsCandidate[] =>
  selectLyricsWordCandidates(db, SAVED_LYRICS, query).map(({ key, lyrics }) => ({
    videoId: String(key),
    lyrics,
  }));
