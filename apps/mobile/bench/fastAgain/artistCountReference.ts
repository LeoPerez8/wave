/** Faithful pre-#600 selectArtists (2aae3bb8); global UNION before filtering/paging. */
import { sql } from "drizzle-orm";
import type { ArtistsQuery } from "../../src/library/db/artists.ts";
import type { LibraryDatabase } from "../../src/library/db/database.ts";
import type { ArtistRow } from "../../src/library/LibraryStore.ts";

export const selectArtistsBefore600 = (
  db: LibraryDatabase,
  { ids, page, scope = "library" }: ArtistsQuery,
): ArtistRow[] => {
  const files = scope === "files" ? sql`WHERE tracks.path IS NOT NULL` : sql``;
  return db.all<ArtistRow>(sql`
    WITH links AS (
      SELECT track_artists.track_id, track_artists.artist_id FROM track_artists
      ${scope === "files" ? sql`JOIN tracks ON tracks.id = track_artists.track_id` : sql``}
      ${files}
      UNION
      SELECT tracks.id, album_artists.artist_id FROM tracks
      JOIN album_artists ON album_artists.album_id = tracks.album_id ${files}
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
    GROUP BY artists.id ORDER BY artists.sort, artists.id
    ${page === undefined ? sql`` : sql`LIMIT ${page.limit} OFFSET ${page.offset}`}`);
};
