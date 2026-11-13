/**
 * Lyrics saved for non-D songs (`schema.savedLyrics`, Core's `SavedLyrics`):
 * what the Lyrics view found online for a song this phone has no file for,
 * or that it found none, by the song's YouTube video. Kept free of Expo for
 * the store tests.
 */
import { normalizeSearchText, type SavedLyrics } from "@wave/core";
import { and, asc, eq, gt, isNotNull, isNull, sql, inArray } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 200;

export interface SavedLyricsCandidate {
  readonly videoId: string;
  readonly lyrics: string;
}

const indexLyrics = (db: LibraryDatabase, videoId: string, lyrics: string | null): void => {
  const index = schema.savedLyricsSearchIndex;
  const wordsTable = schema.savedLyricsSearchWords;
  if (lyrics === null || lyrics.trim() === "") {
    db.delete(index).where(eq(index.videoId, videoId)).run();
    return;
  }
  const words = normalizeSearchText(lyrics).split(" ").filter(Boolean);
  db.insert(index)
    .values({ videoId, lyrics })
    .onConflictDoUpdate({ target: index.videoId, set: { lyrics } })
    .run();
  db.delete(wordsTable).where(eq(wordsTable.videoId, videoId)).run();
  if (words.length === 0) return;
  for (let start = 0; start < words.length; start += 250) {
    db.insert(wordsTable)
      .values(
        words.slice(start, start + 250).map((word, offset) => ({
          videoId,
          position: start + offset,
          word,
        })),
      )
      .run();
  }
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
  indexLyrics(db, videoId, saved.kind === "found" ? saved.lyrics.text : null);
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
  indexLyrics(db, candidate.videoId, candidate.lyrics);

/** Saved non-D lyrics whose indexed words contain [query] contiguously. */
export const selectSavedLyricsCandidates = (
  db: LibraryDatabase,
  query: string,
): SavedLyricsCandidate[] => {
  const words = normalizeSearchText(query).split(" ").filter(Boolean).slice(0, 8);
  if (words.length === 0) return [];
  const joins = words
    .slice(1)
    .map(
      (_, offset) =>
        `JOIN saved_lyrics_search_words w${offset + 1} ON w${offset + 1}.video_id = w0.video_id AND w${offset + 1}.position = w${offset}.position + 1`,
    )
    .join(" ");
  const matchWords = sql.join(
    words.map((word, offset) => sql`${sql.raw(`w${offset}`)}.word = ${word}`),
    sql` AND `,
  );
  return db.all(sql<SavedLyricsCandidate>`
    SELECT i.video_id AS videoId, i.lyrics AS lyrics
    FROM saved_lyrics_search_words w0 ${sql.raw(joins)}
    JOIN saved_lyrics_search_index i ON i.video_id = w0.video_id
    WHERE ${matchWords}
    ORDER BY i.video_id`);
};
