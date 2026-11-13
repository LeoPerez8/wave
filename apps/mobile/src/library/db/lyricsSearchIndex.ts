/** Local, on-device lyrics text and its indexed word-position candidate lookup. */
import { and, asc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import {
  keepLyricsWords,
  selectLyricsWordCandidates,
  type LyricsWordIndex,
} from "./lyricsWordIndex.ts";
import * as schema from "./schema.ts";

const LIBRARY_LYRICS: LyricsWordIndex = {
  texts: "lyrics_search_index",
  words: "lyrics_search_words",
  key: "track_id",
};

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

/** A small keyset page of Library files with lyrics not yet read into the local index. */
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

/** Indexed rows whose file or has-lyrics flag went stale during a broad scan/deletion event. */
export const selectStaleLyricsIndexPage = (
  db: LibraryDatabase,
  afterId: number,
  limit: number,
): LyricsIndexTarget[] => {
  const { tracks, lyricsSearchIndex } = schema;
  return db
    .select({ id: tracks.id, path: tracks.path, hasLyrics: tracks.hasLyrics })
    .from(lyricsSearchIndex)
    .innerJoin(tracks, eq(tracks.id, lyricsSearchIndex.trackId))
    .where(and(gt(tracks.id, afterId), or(isNull(tracks.path), eq(tracks.hasLyrics, false))))
    .orderBy(asc(tracks.id))
    .limit(limit)
    .all();
};

/**
 * Replaces [trackId]'s indexed lyrics (`keepLyricsWords`). Lyrics read as empty
 * keep an empty row, so the background fill reads the file once until a scan or
 * lyrics write refreshes it; null removes the song from the index.
 */
export const keepLyricsSearchText = (
  db: LibraryDatabase,
  trackId: number,
  lyrics: string | null,
): void => keepLyricsWords(db, LIBRARY_LYRICS, trackId, lyrics);

/** Library songs whose indexed lyrics hold [query]'s words in order (`selectLyricsWordCandidates`). */
export const selectLyricsCandidates = (db: LibraryDatabase, query: string): LyricsCandidate[] =>
  selectLyricsWordCandidates(db, LIBRARY_LYRICS, query).map(({ key, lyrics }) => ({
    trackId: Number(key),
    lyrics,
  }));

/** A stored index row, for refresh and deletion behavior tests. */
export const selectLyricsSearchText = (db: LibraryDatabase, trackId: number): string | null =>
  db
    .select({ lyrics: schema.lyricsSearchIndex.lyrics })
    .from(schema.lyricsSearchIndex)
    .where(eq(schema.lyricsSearchIndex.trackId, trackId))
    .get()?.lyrics ?? null;
