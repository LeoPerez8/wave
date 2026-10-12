/**
 * The track rows every song list reads (a `SongRow`). Kept free of Expo so
 * the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import { asc, eq } from "drizzle-orm";

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
