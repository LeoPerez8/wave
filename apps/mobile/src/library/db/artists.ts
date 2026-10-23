/**
 * The artist rows every artist list reads (Library › Artists, search, Stats,
 * Auto's Artists tab). Kept free of Expo so the store tests run it against a
 * real SQLite (`testDatabase.ts`).
 */
import { artistAlbums, artistArtwork, type ArtistAlbumLink } from "@wave/core";
import { eq, inArray, or, sql, type SQL } from "drizzle-orm";

import type { ArtistDetail, ArtistRow } from "../LibraryStore.ts";
import { selectAlbums } from "./albums.ts";
import type { LibraryDatabase, RowPage } from "./database.ts";
import * as schema from "./schema.ts";
import { BY_TITLE, trackQuery, type TrackScope } from "./tracks.ts";

export interface ArtistsQuery {
  /** Only these artists. */
  readonly ids?: readonly number[];
  /** A window of the list. */
  readonly page?: RowPage;
  /** Which songs count (the Library's by default). */
  readonly scope?: TrackScope;
}

/**
 * Every song in [scope] an artist is credited on: each artist its credit
 * names, and each album artist its album's credit names (so Watch the Throne
 * counts for Kanye West as well). A song shows once per artist.
 */
const creditedSongs = (scope: TrackScope = "library", only?: SQL) => {
  const files = scope === "files" ? sql`AND tracks.path IS NOT NULL` : sql``;
  return sql`
    SELECT track_artists.track_id, track_artists.artist_id FROM track_artists
    ${scope === "files" ? sql`JOIN tracks ON tracks.id = track_artists.track_id` : sql``}
    WHERE ${only === undefined ? sql`1` : sql`track_artists.artist_id IN (${only})`} ${files}
    UNION
    SELECT tracks.id, album_artists.artist_id FROM album_artists
    JOIN tracks ON tracks.album_id = album_artists.album_id
    WHERE ${only === undefined ? sql`1` : sql`album_artists.artist_id IN (${only})`} ${files}`;
};

/** Every song an artist is credited on, missing songs included (`creditedSongs`). */
export const CREDITED_SONGS = sql`
  SELECT track_id, artist_id FROM track_artists
  UNION
  SELECT tracks.id, album_artists.artist_id
  FROM tracks JOIN album_artists ON album_artists.album_id = tracks.album_id`;

/**
 * Artists with songs in [scope], by sort name (leading articles and accents
 * ignored, the Library's order): a song belongs to every artist credited on
 * it (`creditedSongs`), so a collaboration counts for each of its artists.
 */
export const selectArtists = (
  db: LibraryDatabase,
  { ids, page, scope = "library" }: ArtistsQuery,
): ArtistRow[] => {
  if (ids?.length === 0) return [];
  const requested =
    ids === undefined
      ? undefined
      : sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        );
  // Membership is cheaper than counting. OFFSET still walks preceding eligible
  // artists (and file checks may visit missing credits), but only this page's
  // credits enter the UNION/count and only its artwork is read.
  const selected =
    page === undefined
      ? sql``
      : sql`
    selected AS MATERIALIZED (
      SELECT artists.* FROM artists
      WHERE ${requested === undefined ? sql`1` : sql`artists.id IN (${requested})`}
        AND (EXISTS (
          SELECT 1 FROM track_artists
          ${scope === "files" ? sql`JOIN tracks ON tracks.id = track_artists.track_id` : sql``}
          WHERE track_artists.artist_id = artists.id
          ${scope === "files" ? sql`AND tracks.path IS NOT NULL` : sql``}
        ) OR EXISTS (
          SELECT 1 FROM album_artists JOIN tracks ON tracks.album_id = album_artists.album_id
          WHERE album_artists.artist_id = artists.id
          ${scope === "files" ? sql`AND tracks.path IS NOT NULL` : sql``}
        ))
      ORDER BY artists.sort, artists.id LIMIT ${page.limit} OFFSET ${page.offset}
    ),`;
  const only = page === undefined ? requested : sql`SELECT id FROM selected`;
  return db.all<ArtistRow>(sql`
    WITH ${selected} links AS (${creditedSongs(scope, only)})
    SELECT artists.id AS "id", artists.name AS "name", artists.sort AS "sort",
      (SELECT count(*) FROM albums WHERE albums.album_artist_id = artists.id) AS "albumCount",
      count(links.track_id) AS "trackCount",
      artwork.thumb_path AS "thumbPath", artwork.path AS "artworkPath"
    FROM ${page === undefined ? sql`artists` : sql`selected AS artists`}
    JOIN links ON links.artist_id = artists.id
    LEFT JOIN artwork ON artwork.hash = artists.artwork_hash
    GROUP BY artists.id
    ORDER BY artists.sort, artists.id`);
};

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
    SELECT links.artist_id, albums.id, 0, count(tracks.id), albums.year, albums.title_sort,
      albums.artwork_hash
    FROM (${CREDITED_SONGS}) AS links
    JOIN tracks ON tracks.id = links.track_id
    JOIN albums ON albums.id = tracks.album_id
    WHERE links.artist_id <> albums.album_artist_id
    GROUP BY links.artist_id, albums.id`);
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
 * An artist's songs in [scope], as their screen lists them: every song
 * they're credited on (`creditedSongs`), by title (`BY_TITLE`); [page] of
 * them if given.
 */
export const selectArtistSongs = (
  db: LibraryDatabase,
  artistId: number,
  page?: RowPage,
  scope: TrackScope = "library",
) => {
  const { tracks } = schema;
  const query = trackQuery(db, scope)
    .where(
      inArray(
        tracks.id,
        sql`(SELECT track_id FROM (${CREDITED_SONGS}) WHERE artist_id = ${artistId})`,
      ),
    )
    .orderBy(...BY_TITLE);
  return page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
};

/**
 * An artist's page: their row, their songs in [scope] (`selectArtistSongs`)
 * and the albums with songs in [scope] they're credited on, split into
 * Albums (filed under them: its first credited album artist) and Appears on
 * (Core's `artistAlbums`). Null when the artist is no longer in the library.
 */
export const selectArtistDetail = (
  db: LibraryDatabase,
  id: number,
  scope: TrackScope = "library",
): ArtistDetail | null => {
  const { artists, albums, artwork } = schema;
  const artist = db
    .select({
      id: artists.id,
      name: artists.name,
      sort: artists.sort,
      thumbPath: artwork.thumbPath,
      artworkPath: artwork.path,
    })
    .from(artists)
    .leftJoin(artwork, eq(artists.artworkHash, artwork.hash))
    .where(eq(artists.id, id))
    .get();
  if (artist === undefined) return null;
  const songs = selectArtistSongs(db, id, undefined, scope);
  const split = artistAlbums(
    id,
    selectAlbums(
      db,
      or(
        inArray(albums.id, sql`(SELECT album_id FROM album_artists WHERE artist_id = ${id})`),
        inArray(
          albums.id,
          sql`(SELECT tracks.album_id FROM track_artists
            JOIN tracks ON tracks.id = track_artists.track_id
            WHERE track_artists.artist_id = ${id})`,
        ),
      ),
      undefined,
      scope,
    ),
  );
  return {
    artist: { ...artist, albumCount: split.albums.length, trackCount: songs.length },
    albums: split.albums,
    appearsOn: split.appearsOn,
    songs,
  };
};

/** Small keyset pages for an explicit artist-link tap; no song/album list decoded. */
export const selectArtistNamesForLink = (
  db: LibraryDatabase,
  after: { readonly sort: string; readonly id: number } | null,
): { id: number; name: string; sort: string }[] =>
  db.all(sql`
  SELECT id, name, sort FROM artists
  WHERE ${after === null ? sql`1` : sql`(sort, id) > (${after.sort}, ${after.id})`}
  AND (EXISTS (SELECT 1 FROM track_artists WHERE artist_id = artists.id)
    OR EXISTS (SELECT 1 FROM album_artists JOIN tracks ON tracks.album_id = album_artists.album_id
      WHERE album_artists.artist_id = artists.id))
  ORDER BY sort, id LIMIT 128`);
