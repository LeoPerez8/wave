/**
 * The play totals Stats ranks, as thin queries over the library database:
 * they only filter (counted plays in a window) and sum. Top songs are songs
 * still in the library; albums and artists keep the plays of deleted songs. Grouping into albums and artists, ordering and the cut-off are
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
 * The album and track artist a play counts for: the track's, or, once the
 * track left the library, those its plays kept (`deleteTracks`).
 */
const creditedAlbum = sql<number>`coalesce(${schema.tracks.albumId}, ${schema.playEvents.albumId})`;
const creditedArtist = sql<number>`coalesce(${schema.tracks.artistId}, ${schema.playEvents.artistId})`;

/**
 * Counted plays within `window` per album and track artist (a compilation
 * gives one row per artist on it), in no order. Deleted songs still count for
 * their album and artist while those are in the library.
 */
export const creditedPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): CreditedPlayTotals[] => {
  const { playEvents, tracks, albums, artists } = schema;
  return db
    .select({
      albumId: albums.id,
      albumSort: albums.titleSort,
      artistId: artists.id,
      artistSort: artists.sort,
      ...sums,
    })
    .from(playEvents)
    .leftJoin(tracks, eq(playEvents.trackId, tracks.id))
    .innerJoin(albums, eq(albums.id, creditedAlbum))
    .innerJoin(artists, eq(artists.id, creditedArtist))
    .where(countedIn(window))
    .groupBy(albums.id, artists.id)
    .all();
};

/**
 * Each played song's listening over all time, one row per song in no order:
 * time listened over every play, its counted plays, its latest play, and its
 * track artist (kept when the song left the library, whose history stays;
 * null if it left before Wave kept it).
 */
export const songListening = (db: LibraryDatabase): SongListening[] => {
  const { playEvents, tracks } = schema;
  return db
    .select({
      trackId: playEvents.trackId,
      artistId: sql<number | null>`${creditedArtist}`,
      inLibrary: sql<boolean>`${tracks.id} IS NOT NULL`.mapWith(Boolean),
      countedPlays: sql<number>`sum(${playEvents.counted})`,
      listenedMs: sql<number>`sum(${playEvents.listenedMs})`,
      lastPlayedAt: sql<number>`max(${playEvents.startedAt})`,
    })
    .from(playEvents)
    .leftJoin(tracks, eq(playEvents.trackId, tracks.id))
    .groupBy(playEvents.trackId)
    .all();
};
