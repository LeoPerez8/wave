/**
 * What Even Shuffle knows of the Library's songs: each one's primary artist,
 * genre and album. Kept free of Expo so the store tests run it against a real
 * SQLite (`testDatabase.ts`).
 */
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, libraryTrackIds, type ShuffleSong } from "@wave/core";
import { eq, inArray } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/**
 * Each of the Library songs among [trackIds]' primary artist, genre and
 * album, by track id (Core's `ShuffleSong`); other songs are left out. The
 * Unknown Artist and Unknown Album stand-ins count as unknown.
 */
export const shuffleSongs = (
  db: LibraryDatabase,
  trackIds: readonly string[],
): Map<string, ShuffleSong> =>
  new Map(
    chunks(libraryTrackIds(trackIds)).flatMap((some) =>
      db
        .select({
          id: schema.tracks.id,
          artist: schema.artists.name,
          genre: schema.genres.name,
          album: schema.albums.title,
        })
        .from(schema.tracks)
        .innerJoin(schema.artists, eq(schema.artists.id, schema.tracks.artistId))
        .innerJoin(schema.albums, eq(schema.albums.id, schema.tracks.albumId))
        .leftJoin(schema.genres, eq(schema.genres.id, schema.tracks.genreId))
        .where(inArray(schema.tracks.id, some))
        .all()
        .map(({ id, artist, genre, album }): [string, ShuffleSong] => [
          String(id),
          {
            artist: artist === UNKNOWN_ARTIST ? null : artist,
            genre,
            album: album === UNKNOWN_ALBUM ? null : album,
          },
        ]),
    ),
  );
