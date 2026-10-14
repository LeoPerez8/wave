/**
 * The track rows every song list reads (a `SongRow`). Kept free of Expo so
 * the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** The ids in a `group_concat` of them ("3,7"), in order; none for null. */
const idList = (value: unknown): number[] =>
  typeof value === "string" && value !== "" ? value.split(",").map(Number) : [];

/**
 * Every artist a track's credit names, primary first: the ids Go to Artist
 * can open (`SongRow.artistIds`).
 */
export const trackArtistIds = sql<readonly number[]>`(
  SELECT group_concat(artist_id) FROM (
    SELECT artist_id FROM track_artists
    WHERE track_artists.track_id = ${schema.tracks.id} ORDER BY position))`.mapWith(idList);

/** Every artist an album's album artist credit names, primary first (`AlbumRow.albumArtistIds`). */
export const albumArtistIds = sql<readonly number[]>`(
  SELECT group_concat(artist_id) FROM (
    SELECT artist_id FROM album_artists
    WHERE album_artists.album_id = ${schema.albums.id} ORDER BY position))`.mapWith(idList);

/** What every track list shows (a `SongRow`), plus what orders albums. */
export const songColumns = {
  id: schema.tracks.id,
  path: schema.tracks.path,
  title: schema.tracks.title,
  artist: schema.tracks.artistCredit,
  album: schema.albums.title,
  durationMs: schema.tracks.durationMs,
  thumbPath: schema.artwork.thumbPath,
  artworkPath: schema.artwork.path,
  titleSort: schema.tracks.titleSort,
  artistSort: schema.artists.sort,
  albumSort: schema.albums.titleSort,
  addedAt: schema.tracks.addedAt,
  albumId: schema.tracks.albumId,
  artistId: schema.tracks.artistId,
  artistIds: trackArtistIds,
  discNumber: schema.tracks.discNumber,
  trackNumber: schema.tracks.trackNumber,
  year: schema.tracks.year,
};

/** Tracks with their `songColumns`. */
export const trackQuery = (db: LibraryDatabase) => {
  const { tracks, artists, albums, artwork } = schema;
  return db
    .select(songColumns)
    .from(tracks)
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash));
};

/** The order of song lists (Songs, an artist's or a genre's songs): by title, then artist. */
export const BY_TITLE = [
  asc(schema.tracks.titleSort),
  asc(schema.artists.sort),
  asc(schema.tracks.path),
] as const;

/**
 * Every song with what a lyrics and genre lookup sends, its genre, whether it
 * has lyrics, its track number and year, by title: the whole-Library run
 * picks from these (Core's `libraryLookupSongs`).
 */
export const selectLibraryLookupSongs = (db: LibraryDatabase) => {
  const { tracks, artists, albums, genres } = schema;
  return db
    .select({
      path: tracks.path,
      title: tracks.title,
      artist: tracks.artistCredit,
      album: albums.title,
      durationMs: tracks.durationMs,
      genre: genres.name,
      hasLyrics: tracks.hasLyrics,
      trackNumber: tracks.trackNumber,
      year: tracks.year,
    })
    .from(tracks)
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(genres, eq(tracks.genreId, genres.id))
    .orderBy(...BY_TITLE)
    .all();
};

/** The indexed files under [roots], for an incremental scan to skip the unchanged ones. */
export const selectKnownFiles = (db: LibraryDatabase, roots: readonly string[]) => {
  if (roots.length === 0) return [];
  const { tracks } = schema;
  const under = roots.map(
    (root) => sql`substr(${tracks.path}, 1, length(${root}) + 1) = ${`${root}/`}`,
  );
  return db
    .select({ path: tracks.path, sizeBytes: tracks.sizeBytes, modifiedAt: tracks.modifiedAt })
    .from(tracks)
    .where(sql.join(under, sql` OR `))
    .all();
};

/** Statements stay small; SQLite's limit on bound parameters is far above this. */
const CHUNK = 500;

/**
 * Deletes the tracks at `paths` (their playlist items and stars go with them).
 * Their play history stays, and keeps each track's album and every artist its
 * credit names, so Stats still credits them (see `play_events.album_id` and
 * `deleted_track_artists`). Run it in the transaction that prunes what the
 * tracks leave empty.
 */
export const deleteTracks = (db: LibraryDatabase, paths: readonly string[]): void => {
  const { tracks, playEvents, trackArtists, deletedTrackArtists } = schema;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const leaving = db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.path, chunk));
    db.update(playEvents)
      .set({
        albumId: sql`(SELECT ${tracks.albumId} FROM ${tracks} WHERE ${tracks.id} = ${playEvents.trackId})`,
      })
      .where(inArray(playEvents.trackId, leaving))
      .run();
    db.insert(deletedTrackArtists)
      .select(
        db
          .select({
            trackId: trackArtists.trackId,
            artistId: trackArtists.artistId,
            position: trackArtists.position,
          })
          .from(trackArtists)
          .where(
            and(
              inArray(trackArtists.trackId, leaving),
              inArray(trackArtists.trackId, db.select({ id: playEvents.trackId }).from(playEvents)),
            ),
          ),
      )
      .onConflictDoNothing()
      .run();
    db.delete(tracks).where(inArray(tracks.path, chunk)).run();
  }
};
