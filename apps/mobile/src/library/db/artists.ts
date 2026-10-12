/**
 * The artist rows every artist list reads (Library › Artists, search, Stats,
 * Auto's Artists tab). Kept free of Expo so the store tests run it against a
 * real SQLite (`testDatabase.ts`).
 */
import { eq, inArray, or, sql } from "drizzle-orm";

import type { ArtistRow } from "../LibraryStore.ts";
import type { LibraryDatabase, RowPage } from "./database.ts";
import * as schema from "./schema.ts";
import { BY_TITLE, trackQuery } from "./tracks.ts";

export interface ArtistsQuery {
  /** Only these artists. */
  readonly ids?: readonly number[];
  /** A window of the list. */
  readonly page?: RowPage;
}

/**
 * Artists with songs, by sort name (leading articles and accents ignored,
 * the Library's order): a song belongs to its track artist and to the album
 * artist of its album (so Watch the Throne counts for Kanye West as well).
 */
export const selectArtists = (db: LibraryDatabase, { ids, page }: ArtistsQuery): ArtistRow[] =>
  db.all<ArtistRow>(sql`
    WITH links AS (
      SELECT id AS track_id, artist_id FROM tracks
      UNION
      SELECT tracks.id, albums.album_artist_id FROM tracks JOIN albums ON albums.id = tracks.album_id
    )
    SELECT artists.id AS "id", artists.name AS "name", artists.sort AS "sort",
      (SELECT count(*) FROM albums WHERE albums.album_artist_id = artists.id) AS "albumCount",
      count(links.track_id) AS "trackCount"
    FROM artists JOIN links ON links.artist_id = artists.id
    ${
      ids === undefined
        ? sql``
        : sql`WHERE artists.id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`
    }
    GROUP BY artists.id
    ORDER BY artists.sort, artists.id
    ${page === undefined ? sql`` : sql`LIMIT ${page.limit} OFFSET ${page.offset}`}`);

/**
 * A cover for each of [ids] that has one (Auto shows artists with it): the
 * first of their albums with artwork, by title, else the artwork of one of
 * their songs. Artists without any artwork are left out.
 */
export const selectArtistCovers = (
  db: LibraryDatabase,
  ids: readonly number[],
): Map<number, string> => {
  if (ids.length === 0) return new Map();
  const rows = db.all<{ id: number; path: string | null }>(sql`
    SELECT artists.id AS "id", coalesce(
      (SELECT artwork.path FROM albums JOIN artwork ON artwork.hash = albums.artwork_hash
        WHERE albums.album_artist_id = artists.id ORDER BY albums.title_sort, albums.id LIMIT 1),
      (SELECT artwork.path FROM tracks JOIN artwork ON artwork.hash = tracks.artwork_hash
        WHERE tracks.artist_id = artists.id ORDER BY tracks.title_sort, tracks.id LIMIT 1)
    ) AS "path"
    FROM artists
    WHERE artists.id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  return new Map(rows.flatMap((row) => (row.path === null ? [] : [[row.id, row.path] as const])));
};

/**
 * An artist's songs, as their screen lists them: theirs as track artist and
 * every song on their albums, by title (`BY_TITLE`); [page] of them if given.
 */
export const selectArtistSongs = (db: LibraryDatabase, artistId: number, page?: RowPage) => {
  const { albums, tracks } = schema;
  const query = trackQuery(db)
    .where(
      or(
        eq(tracks.artistId, artistId),
        inArray(
          tracks.albumId,
          db.select({ id: albums.id }).from(albums).where(eq(albums.albumArtistId, artistId)),
        ),
      ),
    )
    .orderBy(...BY_TITLE);
  return page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
};
