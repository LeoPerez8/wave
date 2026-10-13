/**
 * The rows behind a link to an album or artist (Go to Album / Artist, Now
 * Playing, an album's artist), read ahead so the screen it opens draws its
 * header on the first frame. Kept free of Expo so the store tests run it
 * against a real SQLite (`testDatabase.ts`).
 */
import { eq, sql } from "drizzle-orm";

import type { AlbumRow, ArtistRow } from "../LibraryStore.ts";
import { selectAlbums } from "./albums.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

export interface LinkIds {
  readonly albumId?: number | undefined;
  readonly artistId?: number | undefined;
}

export interface LinkRows {
  /** Null when not asked for or gone from the library. */
  readonly album: AlbumRow | null;
  readonly artist: ArtistRow | null;
}

/**
 * One artist's row as `selectArtists` lists it, but counted from that
 * artist's own tracks and albums (by index) rather than from every song's
 * links: a menu opening or a track change reads it, so it must stay cheap.
 * Null for an artist with no songs, as the list leaves them out.
 */
const selectArtistRow = (db: LibraryDatabase, artistId: number): ArtistRow | null =>
  db.all<ArtistRow>(sql`
    SELECT * FROM (
      SELECT artists.id AS "id", artists.name AS "name", artists.sort AS "sort",
        (SELECT count(*) FROM albums WHERE albums.album_artist_id = artists.id) AS "albumCount",
        (SELECT count(*) FROM tracks WHERE tracks.artist_id = artists.id
          OR tracks.album_id IN (SELECT id FROM albums WHERE albums.album_artist_id = artists.id)
        ) AS "trackCount",
        artwork.thumb_path AS "thumbPath", artwork.path AS "artworkPath"
      FROM artists LEFT JOIN artwork ON artwork.hash = artists.artwork_hash
      WHERE artists.id = ${artistId}
    ) WHERE "trackCount" > 0`)[0] ?? null;

/** The album and artist rows, as their lists show them, of the links asked for. */
export const selectLinkRows = (db: LibraryDatabase, { albumId, artistId }: LinkIds): LinkRows => ({
  album:
    albumId === undefined ? null : (selectAlbums(db, eq(schema.albums.id, albumId))[0] ?? null),
  artist: artistId === undefined ? null : selectArtistRow(db, artistId),
});
