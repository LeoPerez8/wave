/** Local, on-device lyrics text and its indexed word-position candidate lookup. */
import { normalizeSearchText } from "@wave/core";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

export interface LyricsIndexTrack {
  readonly id: number;
  readonly path: string;
}

export interface LyricsCandidate {
  readonly trackId: number;
  readonly lyrics: string;
}

export interface LyricsIndexTarget {
  readonly id: number;
  readonly path: string | null;
  readonly hasLyrics: boolean;
}

/** The current file and lyrics flag for a changed Track. */
export const selectLyricsIndexTarget = (
  db: LibraryDatabase,
  trackId: number,
): LyricsIndexTarget | null => {
  const row = db
    .select({ id: schema.tracks.id, path: schema.tracks.path, hasLyrics: schema.tracks.hasLyrics })
    .from(schema.tracks)
    .where(eq(schema.tracks.id, trackId))
    .get();
  return row ?? null;
};

/** Finds the Track a lyrics write affected; a file that left the Library has none. */
export const selectLyricsTrackIdAtPath = (db: LibraryDatabase, path: string): number | null =>
  db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.path, path)).get()
    ?.id ?? null;

/** A small keyset page of Library files with lyrics not yet copied into the local index. */
export const selectLyricsIndexPage = (
  db: LibraryDatabase,
  afterId: number,
  limit: number,
): LyricsIndexTarget[] => {
  const { tracks, lyricsSearchIndex } = schema;
  return db
    .select({ id: tracks.id, path: tracks.path, hasLyrics: tracks.hasLyrics })
    .from(tracks)
    .leftJoin(lyricsSearchIndex, eq(lyricsSearchIndex.trackId, tracks.id))
    .where(
      and(
        gt(tracks.id, afterId),
        eq(tracks.hasLyrics, true),
        isNotNull(tracks.path),
        isNull(lyricsSearchIndex.trackId),
      ),
    )
    .orderBy(asc(tracks.id))
    .limit(limit)
    .all()
    .filter((track): track is LyricsIndexTarget => track.path !== null);
};

/** Replaces [trackId]'s indexed lyrics. Empty text removes it from Search. */
export const keepLyricsSearchText = (
  db: LibraryDatabase,
  trackId: number,
  lyrics: string,
): void => {
  const text = lyrics.trim();
  const table = schema.lyricsSearchIndex;
  if (text === "") {
    db.delete(table).where(eq(table.trackId, trackId)).run();
    return;
  }
  const words = normalizeSearchText(text).split(" ").filter(Boolean);
  if (words.length === 0) {
    db.delete(table).where(eq(table.trackId, trackId)).run();
    return;
  }
  db.transaction((tx) => {
    tx.insert(table)
      .values({ trackId, lyrics: text })
      .onConflictDoUpdate({ target: table.trackId, set: { lyrics: text } })
      .run();
    const tokens = schema.lyricsSearchWords;
    tx.delete(tokens).where(eq(tokens.trackId, trackId)).run();
    for (let start = 0; start < words.length; start += 250) {
      tx.insert(tokens)
        .values(
          words.slice(start, start + 250).map((word, offset) => ({
            trackId,
            position: start + offset,
            word,
          })),
        )
        .run();
    }
  });
};

/** The indexed first word and adjacent positions narrow candidates before Core verifies lines. */
export const selectLyricsCandidates = (db: LibraryDatabase, query: string): LyricsCandidate[] => {
  const normalized = normalizeSearchText(query);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) return [];
  // The first eight ordered words are enough to narrow candidates; Core verifies the full phrase.
  const candidateWords = words.slice(0, 8);
  const joins = candidateWords
    .slice(1)
    .map(
      (_, offset) =>
        `JOIN lyrics_search_words w${offset + 1} ON w${offset + 1}.track_id = w0.track_id AND w${offset + 1}.position = w${offset}.position + 1`,
    )
    .join(" ");
  const matchWords = sql.join(
    candidateWords.map((word, offset) => sql`${sql.raw(`w${offset}`)}.word = ${word}`),
    sql` AND `,
  );
  return db.all(sql<LyricsCandidate>`
    SELECT i.track_id AS trackId, i.lyrics AS lyrics
    FROM lyrics_search_words w0 ${sql.raw(joins)}
    JOIN lyrics_search_index i ON i.track_id = w0.track_id
    WHERE ${matchWords}
    ORDER BY i.track_id`);
};

/** A stored index row, for refresh and deletion behavior tests. */
export const selectLyricsSearchText = (db: LibraryDatabase, trackId: number): string | null =>
  db
    .select({ lyrics: schema.lyricsSearchIndex.lyrics })
    .from(schema.lyricsSearchIndex)
    .where(eq(schema.lyricsSearchIndex.trackId, trackId))
    .get()?.lyrics ?? null;
