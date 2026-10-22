/** #596 research probes only; these do not replace any production query. */
import { sql } from "drizzle-orm";
import type { LibraryDatabase } from "../../src/library/db/database.ts";
import type { ArtistRow } from "../../src/library/LibraryStore.ts";

/** Push the requested artists into both credit branches before deduplicating. */
export const scopedArtistProbe = (db: LibraryDatabase, ids: readonly number[]): ArtistRow[] => {
  const only = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  return db.all<ArtistRow>(sql`
    WITH links AS (
      SELECT track_id, artist_id FROM track_artists WHERE artist_id IN (${only})
      UNION
      SELECT tracks.id, album_artists.artist_id FROM tracks
      JOIN album_artists ON album_artists.album_id = tracks.album_id
      WHERE album_artists.artist_id IN (${only})
    )
    SELECT artists.id AS "id", artists.name AS "name", artists.sort AS "sort",
      (SELECT count(*) FROM albums WHERE albums.album_artist_id = artists.id) AS "albumCount",
      count(links.track_id) AS "trackCount",
      artwork.thumb_path AS "thumbPath", artwork.path AS "artworkPath"
    FROM artists JOIN links ON links.artist_id = artists.id
    LEFT JOIN artwork ON artwork.hash = artists.artwork_hash
    WHERE artists.id IN (${only})
    GROUP BY artists.id ORDER BY artists.sort, artists.id`);
};
