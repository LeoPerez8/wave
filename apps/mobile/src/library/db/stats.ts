/**
 * The play totals Stats ranks, as thin queries over the library database:
 * they only filter (counted plays in a window, tracks still in the library)
 * and sum. Grouping into albums and artists, ordering and the cut-off are
 * Core's (`albumPlayTotals`, `artistPlayTotals`, `rankPlays`); so are the
 * all-time listening totals (`listeningTotals`) summed from `songListening`. Kept free of Expo
 * so the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import type { CreditedPlayTotals, PlayTotals, SongListening, StatsWindow } from "@wave/core";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** Counted plays that started within `window`. */
const countedIn = (window: StatsWindow): SQL | undefined => {
  const { playEvents } = schema;
  return and(
    eq(playEvents.counted, true),
    window.from === null ? undefined : gte(playEvents.startedAt, window.from),
    lte(playEvents.startedAt, window.to),
  );
};

/** What every aggregate sums over its counted plays. */
const sums = {
  countedPlays: sql<number>`count(*)`,
  listenedMs: sql<number>`sum(${schema.playEvents.listenedMs})`,
  latestPlayAt: sql<number>`max(${schema.playEvents.startedAt})`,
};

/** Each track's counted plays within `window`, for tracks still in the library, in no order. */
export const trackPlayTotals = (db: LibraryDatabase, window: StatsWindow): PlayTotals[] => {
  const { playEvents, tracks } = schema;
  return db
    .select({ id: tracks.id, sortKey: tracks.titleSort, ...sums })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .where(countedIn(window))
    .groupBy(tracks.id)
    .all();
};

/**
 * Counted plays within `window` per album and track artist (a compilation
 * gives one row per artist on it), for tracks still in the library, in no order.
 */
export const creditedPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): CreditedPlayTotals[] => {
  const { playEvents, tracks, albums, artists } = schema;
  return db
    .select({
      albumId: tracks.albumId,
      albumSort: albums.titleSort,
      artistId: tracks.artistId,
      artistSort: artists.sort,
      ...sums,
    })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .where(countedIn(window))
    .groupBy(tracks.albumId, tracks.artistId)
    .all();
};

/**
 * Each played song's listening over all time, one row per song in no order:
 * time listened over every play, its counted plays, its latest play, and its
 * track artist (null once the song left the library, whose history stays).
 */
export const songListening = (db: LibraryDatabase): SongListening[] => {
  const { playEvents, tracks } = schema;
  return db
    .select({
      trackId: playEvents.trackId,
      artistId: tracks.artistId,
      countedPlays: sql<number>`sum(${playEvents.counted})`,
      listenedMs: sql<number>`sum(${playEvents.listenedMs})`,
      lastPlayedAt: sql<number>`max(${playEvents.startedAt})`,
    })
    .from(playEvents)
    .leftJoin(tracks, eq(playEvents.trackId, tracks.id))
    .groupBy(playEvents.trackId)
    .all();
};
