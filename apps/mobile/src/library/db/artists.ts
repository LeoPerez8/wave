/**
 * The artist rows every artist list reads (Library › Artists, search, Stats,
 * Auto's Artists tab). Kept free of Expo so the store tests run it against a
 * real SQLite (`testDatabase.ts`).
 */
import { artistArtwork, type ArtistAlbumLink } from "@wave/core";
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
      count(links.track_id) AS "trackCount",
      artwork.thumb_path AS "thumbPath", artwork.path AS "artworkPath"
    FROM artists JOIN links ON links.artist_id = artists.id
    LEFT JOIN artwork ON artwork.hash = artists.artwork_hash
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
 * Re-picks every artist's image (Core's `artistArtwork`) from the albums
 * they're on now. Run it after a scan has added, changed or removed tracks,
 * inside the transaction that did so.
 */
export const refreshArtistImages = (db: LibraryDatabase): void => {
  const links = db.all<Omit<ArtistAlbumLink, "own"> & { own: number }>(sql`
    SELECT albums.album_artist_id AS "artistId", albums.id AS "albumId", 1 AS "own",
      count(tracks.id) AS "songs", albums.year AS "year", albums.title_sort AS "titleSort",
      albums.artwork_hash AS "artwork"
    FROM albums JOIN tracks ON tracks.album_id = albums.id
    GROUP BY albums.id
    UNION ALL
    SELECT tracks.artist_id, albums.id, 0, count(tracks.id), albums.year, albums.title_sort,
      albums.artwork_hash
    FROM tracks JOIN albums ON albums.id = tracks.album_id
    WHERE tracks.artist_id <> albums.album_artist_id
    GROUP BY tracks.artist_id, albums.id`);
  const images = artistArtwork(links.map((link) => ({ ...link, own: link.own === 1 })));
  const { artists } = schema;
  const current = db
    .select({ id: artists.id, artworkHash: artists.artworkHash })
    .from(artists)
    .all();
  for (const artist of current) {
    const image = images.get(artist.id) ?? null;
    if (image !== artist.artworkHash) {
      db.update(artists).set({ artworkHash: image }).where(eq(artists.id, artist.id)).run();
    }
  }
};

/**
 * A cover for each of [ids] that has one (Auto shows artists with it): the
 * artist's image (see `refreshArtistImages`). Artists without one are left out.
 */
export const selectArtistCovers = (
  db: LibraryDatabase,
  ids: readonly number[],
): Map<number, string> => {
  if (ids.length === 0) return new Map();
  const rows = db.all<{ id: number; path: string }>(sql`
    SELECT artists.id AS "id", artwork.path AS "path"
    FROM artists JOIN artwork ON artwork.hash = artists.artwork_hash
    WHERE artists.id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  return new Map(rows.map((row) => [row.id, row.path] as const));
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
