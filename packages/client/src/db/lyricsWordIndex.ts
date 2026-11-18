/**
 * The word-position index both lyrics Search indexes share: Library songs'
 * (`lyrics_search_index`, by track) and lyrics saved for streamed songs
 * (`saved_lyrics_search_index`, by video). Each keeps one text row per song and
 * its normalized words in order, so a phrase is looked up as adjacent positions.
 */
import { normalizeSearchText } from "@wave/core";
import { sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";

/** One lyrics index: its text table, its words table and the column naming the song in both. */
export interface LyricsWordIndex {
  readonly texts: "lyrics_search_index" | "saved_lyrics_search_index";
  readonly words: "lyrics_search_words" | "saved_lyrics_search_words";
  readonly key: "track_id" | "video_id";
}

/**
 * The most songs one index hands Search per query, each once. Search shows five
 * until Show all; a common word ("love") would otherwise read every song's lyrics.
 */
export const LYRICS_CANDIDATE_LIMIT = 100;

/** Rows per insert; three variables each, well under SQLite's cap. */
const WORDS_PER_INSERT = 250;

/**
 * Replaces [key]'s text and words in one transaction. Null removes the song
 * from the index; text with no words keeps an empty row, which marks the song
 * checked so the background fill doesn't read it again.
 */
export const keepLyricsWords = (
  db: LibraryDatabase,
  index: LyricsWordIndex,
  key: number | string,
  lyrics: string | null,
): void => {
  const texts = sql.raw(index.texts);
  const wordsTable = sql.raw(index.words);
  const column = sql.raw(index.key);
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM ${wordsTable} WHERE ${column} = ${key}`);
    if (lyrics === null) {
      tx.run(sql`DELETE FROM ${texts} WHERE ${column} = ${key}`);
      return;
    }
    const text = lyrics.trim();
    tx.run(
      sql`INSERT INTO ${texts} (${column}, lyrics) VALUES (${key}, ${text})
          ON CONFLICT (${column}) DO UPDATE SET lyrics = excluded.lyrics`,
    );
    const words = normalizeSearchText(text).split(" ").filter(Boolean);
    for (let start = 0; start < words.length; start += WORDS_PER_INSERT) {
      const rows = words
        .slice(start, start + WORDS_PER_INSERT)
        .map((word, offset) => sql`(${key}, ${start + offset}, ${word})`);
      tx.run(
        sql`INSERT INTO ${wordsTable} (${column}, position, word) VALUES ${sql.join(rows, sql`, `)}`,
      );
    }
  });
};

/**
 * The songs whose indexed words hold [query]'s first eight words next to one
 * another, each once, at most `LYRICS_CANDIDATE_LIMIT` of them, with their text.
 * Core's `findLyricMatch` then verifies the whole phrase within one line.
 */
export const selectLyricsWordCandidates = (
  db: LibraryDatabase,
  index: LyricsWordIndex,
  query: string,
): { readonly key: number | string; readonly lyrics: string }[] => {
  const words = normalizeSearchText(query).split(" ").filter(Boolean).slice(0, 8);
  if (words.length === 0) return [];
  const column = index.key;
  const joins = words
    .slice(1)
    .map(
      (_, offset) =>
        `JOIN ${index.words} w${offset + 1} ON w${offset + 1}.${column} = w0.${column} AND w${offset + 1}.position = w${offset}.position + 1`,
    )
    .join(" ");
  const matchWords = sql.join(
    words.map((word, offset) => sql`${sql.raw(`w${offset}`)}.word = ${word}`),
    sql` AND `,
  );
  return db.all(sql<{ key: number | string; lyrics: string }>`
    SELECT i.${sql.raw(column)} AS key, i.lyrics AS lyrics
    FROM ${sql.raw(index.texts)} i
    WHERE i.${sql.raw(column)} IN (
      SELECT DISTINCT w0.${sql.raw(column)}
      FROM ${sql.raw(index.words)} w0 ${sql.raw(joins)}
      WHERE ${matchWords}
      ORDER BY w0.${sql.raw(column)}
      LIMIT ${LYRICS_CANDIDATE_LIMIT}
    )
    ORDER BY i.${sql.raw(column)}`);
};
