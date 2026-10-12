/**
 * The artist rows every artist list reads (Library › Artists, search, Stats,
 * Auto's Artists tab). Kept free of Expo so the store tests run it against a
 * real SQLite (`testDatabase.ts`).
 */
import { sql } from "drizzle-orm";

import type { ArtistRow } from "../LibraryStore.ts";
import type { RowPage } from "./albums.ts";
import type { LibraryDatabase } from "./playHistory.ts";

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
