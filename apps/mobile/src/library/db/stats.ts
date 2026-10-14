/**
 * The play totals Stats ranks, as thin queries over the library database:
 * they only filter (counted plays in a window) and sum. Top songs are songs
 * still in the library; albums and artists keep the plays of deleted songs.
 * A song's plays count for every artist its credit names, so a collaboration
 * counts for each of them. Grouping into albums and artists, ordering and the
 * cut-off are Core's (`albumPlayTotals`, `artistPlayTotals`, `rankPlays`); so
 * are the all-time listening totals (`listeningTotals`) summed from
 * `songListening`. Kept free of Expo so the store tests run them against a
 * real SQLite (`testDatabase.ts`).
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
 * The artists a song's plays count for (`track_id`, `artist_id`, `position`
 * in its credit): every artist its credit names, or, once the song left the
 * library, those its plays kept (`deleteTracks`). Only artists in the library.
 */
const CREDITED_ARTISTS = sql`
  SELECT track_id, artist_id, position FROM track_artists
  UNION ALL
  SELECT track_id, artist_id, position FROM deleted_track_artists`;

/**
 * Counted plays within `window` per album and credited artist (a compilation
 * gives one row per artist on it, a collaboration one per artist it credits),
 * in no order. Deleted songs still count for their album and artists while
 * those are in the library.
 */
export const creditedPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): CreditedPlayTotals[] =>
  db
    .all<Omit<CreditedPlayTotals, "primary"> & { primary: number }>(
      sql`WITH plays AS (
        SELECT play_events.track_id AS track_id, max(play_events.album_id) AS album_id,
          ${sums.countedPlays} AS plays, ${sums.listenedMs} AS listened,
          ${sums.latestPlayAt} AS latest
        FROM play_events WHERE ${countedIn(window)}
        GROUP BY play_events.track_id
      ), credited AS (${CREDITED_ARTISTS})
      SELECT albums.id AS "albumId", albums.title_sort AS "albumSort",
        artists.id AS "artistId", artists.sort AS "artistSort",
        credited.position = (SELECT min(first.position) FROM credited AS first
          WHERE first.track_id = plays.track_id) AS "primary",
        sum(plays.plays) AS "countedPlays", sum(plays.listened) AS "listenedMs",
        max(plays.latest) AS "latestPlayAt"
      FROM plays
      LEFT JOIN tracks ON tracks.id = plays.track_id
      JOIN albums ON albums.id = coalesce(tracks.album_id, plays.album_id)
      JOIN credited ON credited.track_id = plays.track_id
      JOIN artists ON artists.id = credited.artist_id
      GROUP BY albums.id, artists.id, "primary"`,
    )
    .map((row) => ({ ...row, primary: row.primary === 1 }));

/**
 * Each played song's listening over all time, one row per song in no order:
 * time listened over every play, its counted plays, its latest play, and the
 * artists its credit names (kept when the song left the library, whose
 * history stays; none if it left before Wave kept them).
 */
export const songListening = (db: LibraryDatabase): SongListening[] => {
  const { playEvents, tracks } = schema;
  const artists = new Map<number, number[]>();
  for (const link of db.all<{ trackId: number; artistId: number }>(
    sql`WITH credited AS (${CREDITED_ARTISTS})
      SELECT track_id AS "trackId", artist_id AS "artistId" FROM credited
      WHERE track_id IN (SELECT track_id FROM play_events)
      ORDER BY track_id, position`,
  )) {
    const ids = artists.get(link.trackId) ?? [];
    ids.push(link.artistId);
    artists.set(link.trackId, ids);
  }
  return db
    .select({
      trackId: playEvents.trackId,
      inLibrary: sql<boolean>`${tracks.id} IS NOT NULL`.mapWith(Boolean),
      countedPlays: sql<number>`sum(${playEvents.counted})`,
      listenedMs: sql<number>`sum(${playEvents.listenedMs})`,
      lastPlayedAt: sql<number>`max(${playEvents.startedAt})`,
    })
    .from(playEvents)
    .leftJoin(tracks, eq(playEvents.trackId, tracks.id))
    .groupBy(playEvents.trackId)
    .all()
    .map(({ trackId, ...song }) => ({ trackId, artistIds: artists.get(trackId) ?? [], ...song }));
};

/**
 * The songs in the library whose credit names [artistId], in no order: the
 * songs their plays count for, which the artist page's stats block counts its
 * songs listened among (Core's `artistStats`).
 */
export const songsCrediting = (db: LibraryDatabase, artistId: number): number[] => {
  const { trackArtists } = schema;
  return db
    .selectDistinct({ id: trackArtists.trackId })
    .from(trackArtists)
    .where(eq(trackArtists.artistId, artistId))
    .all()
    .map((row) => row.id);
};
