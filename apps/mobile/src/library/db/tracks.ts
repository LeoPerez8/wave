/**
 * The track rows every song list reads (a `SongRow`). Kept free of Expo so
 * the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import { asc, eq, inArray, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** What every track list shows (a `SongRow`), plus what orders albums and folders. */
export const songColumns = {
  id: schema.tracks.id,
  path: schema.tracks.path,
  title: schema.tracks.title,
  artist: schema.artists.name,
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
  discNumber: schema.tracks.discNumber,
  trackNumber: schema.tracks.trackNumber,
  fileName: schema.tracks.fileName,
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
 * Every song with what a lyrics and genre lookup sends, its genre and whether
 * it has lyrics, by title: the whole-Library run picks from these (Core's
 * `libraryLookupSongs`).
 */
export const selectLibraryLookupSongs = (db: LibraryDatabase) => {
  const { tracks, artists, albums, genres } = schema;
  return db
    .select({
      path: tracks.path,
      title: tracks.title,
      artist: artists.name,
      album: albums.title,
      durationMs: tracks.durationMs,
      genre: genres.name,
      hasLyrics: tracks.hasLyrics,
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
 * Their play history stays, and keeps each track's album and track artist, so
 * Stats still credits them (see `play_events.album_id`). Run it in the
 * transaction that prunes what the tracks leave empty.
 */
export const deleteTracks = (db: LibraryDatabase, paths: readonly string[]): void => {
  const { tracks, playEvents } = schema;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const leaving = db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.path, chunk));
    const ofTrack = (column: typeof tracks.albumId | typeof tracks.artistId) =>
      sql`(SELECT ${column} FROM ${tracks} WHERE ${tracks.id} = ${playEvents.trackId})`;
    db.update(playEvents)
      .set({ albumId: ofTrack(tracks.albumId), artistId: ofTrack(tracks.artistId) })
      .where(inArray(playEvents.trackId, leaving))
      .run();
    db.delete(tracks).where(inArray(tracks.path, chunk)).run();
  }
};
