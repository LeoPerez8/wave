/**
 * The track rows every song list reads (a `SongRow`). Kept free of Expo so
 * the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import { readStoredGenres } from "@wave/core";
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import { chunks } from "./chunks.ts";
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

/**
 * Tracks with a file. A missing song (a Track the Wave account has and this
 * phone has no file for: `path` null) shows in the Library's lists, but
 * can't be played from a file, so what plays or reads files reads only
 * these: the queue and Android Auto (`TrackScope` "files"), and the scan's,
 * imports' and lookups' queries (`filePath` where `hasFile`).
 */
export const hasFile = isNotNull(schema.tracks.path);

/** A join's [on] condition, for joining `tracks`: only tracks with a file (`hasFile`). */
export const withFile = (on: SQL): SQL => and(on, hasFile) ?? on;

/** A track's file, for queries that read only tracks with one (`hasFile`, `withFile`). */
export const filePath = sql<string>`${schema.tracks.path}`;

/**
 * Which Tracks a read sees: the Library's (every song, missing songs
 * included, as its lists show them) or only those with a file (what plays:
 * the queue, Android Auto).
 */
export type TrackScope = "library" | "files";

/** A join's [on] condition for joining `tracks` in [scope]. */
export const inScope = (on: SQL, scope: TrackScope): SQL => (scope === "files" ? withFile(on) : on);

/** A track's genre; null without one. */
const trackGenre = sql<string | null>`(
  SELECT name FROM genres WHERE genres.id = ${schema.tracks.genreId})`;

/** What every track list shows (a `SongRow`), plus what orders albums. Join `tracks` `inScope`. */
export const songColumns = {
  id: schema.tracks.id,
  /** Null for a missing song. */
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
  genre: trackGenre,
  hasLyrics: schema.tracks.hasLyrics,
  explicit: schema.tracks.explicit,
};

/** The Tracks in [scope], with their `songColumns`. */
export const trackQuery = (db: LibraryDatabase, scope: TrackScope = "library") => {
  const { tracks, artists, albums, artwork } = schema;
  return (
    db
      .select(songColumns)
      .from(tracks)
      // In the join, so that callers' own `where` keeps it.
      .innerJoin(artists, inScope(eq(tracks.artistId, artists.id), scope))
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
  );
};

/**
 * The songs with these ids that can play (those with a file: a queue's), in
 * no particular order; ids no longer in the Library, or missing songs, are left out.
 */
export const selectPlayableSongs = (db: LibraryDatabase, ids: readonly number[]) =>
  chunks(ids).flatMap((some) =>
    trackQuery(db, "files").where(inArray(schema.tracks.id, some)).all(),
  );

/** A song whose genre tag has several values, with each of them. */
export interface SongGenres {
  readonly id: number;
  readonly genres: readonly string[];
}

/**
 * The songs whose genre tag has several values, with every value (the first
 * is the genre the Library files them under): what Genre mixes count. A
 * song whose stored values can't be read (`readStoredGenres`) is left out.
 */
export const selectSongGenres = (db: LibraryDatabase): SongGenres[] =>
  db
    .select({ id: schema.tracks.id, genres: schema.tracks.genres })
    .from(schema.tracks)
    .where(isNotNull(schema.tracks.genres))
    .orderBy(asc(schema.tracks.id))
    .all()
    .flatMap((row) => {
      const genres = readStoredGenres(row.genres);
      return genres.length === 0 ? [] : [{ id: row.id, genres }];
    });

/** The order of song lists (Songs, an artist's or a genre's songs): by title, then artist. */
export const BY_TITLE = [
  asc(schema.tracks.titleSort),
  asc(schema.artists.sort),
  asc(schema.tracks.path),
] as const;

/**
 * Every song with what a lyrics and genre lookup sends, its genre, whether it
 * has lyrics, its track number, year and explicit flag, by title: the
 * whole-Library run picks from these (Core's `songsToFix`).
 */
export const selectLibraryLookupSongs = (db: LibraryDatabase) => {
  const { tracks, artists, albums, genres } = schema;
  return db
    .select({
      path: filePath,
      title: tracks.title,
      artist: tracks.artistCredit,
      album: albums.title,
      durationMs: tracks.durationMs,
      genre: genres.name,
      hasLyrics: tracks.hasLyrics,
      trackNumber: tracks.trackNumber,
      year: tracks.year,
      explicit: tracks.explicit,
    })
    .from(tracks)
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(genres, eq(tracks.genreId, genres.id))
    .where(hasFile)
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
    .select({ path: filePath, sizeBytes: tracks.sizeBytes, modifiedAt: tracks.modifiedAt })
    .from(tracks)
    .where(and(hasFile, sql.join(under, sql` OR `)))
    .all();
};

/**
 * Deletes the tracks at `paths` (their playlist items and stars go with them).
 * Their play history stays, and keeps each track's album and every artist its
 * credit names, so Stats still credits them (see `play_events.album_id` and
 * `deleted_track_artists`). Run it in the transaction that prunes what the
 * tracks leave empty.
 */
export const deleteTracks = (db: LibraryDatabase, paths: readonly string[]): void => {
  for (const some of chunks(paths)) deleteTracksWhere(db, inArray(schema.tracks.path, some));
};

/** Deletes the Tracks with these ids, missing songs included, as `deleteTracks` deletes files'. */
export const deleteTracksById = (db: LibraryDatabase, ids: readonly number[]): void => {
  for (const some of chunks(ids)) deleteTracksWhere(db, inArray(schema.tracks.id, some));
};

/** Deletes the tracks [which] picks (a chunk's worth), keeping what their plays need. */
const deleteTracksWhere = (db: LibraryDatabase, which: SQL): void => {
  const { tracks, playEvents, trackArtists, deletedTrackArtists } = schema;
  const leaving = db.select({ id: tracks.id }).from(tracks).where(which);
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
  db.delete(tracks).where(which).run();
};
