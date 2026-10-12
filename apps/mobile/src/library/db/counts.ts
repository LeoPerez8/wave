/**
 * How many items each Library entry holds, for the counts on the Library tab.
 * Kept free of Expo so the store tests run it against a real SQLite
 * (`testDatabase.ts`).
 */
import { sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";

/** One count per Library entry, keyed by its section slug. */
export interface LibraryCounts {
  readonly playlists: number;
  readonly artists: number;
  readonly albums: number;
  readonly songs: number;
  readonly genres: number;
  readonly folders: number;
  readonly favorites: number;
}

/**
 * Counts what each Library list shows: every playlist (empty ones too); artists,
 * albums, genres and folders with songs (an artist counts through its songs or
 * its albums', as Library › Artists lists them); songs; and starred songs.
 */
export const libraryCounts = (db: LibraryDatabase): LibraryCounts =>
  db.get<LibraryCounts>(sql`
    SELECT
      (SELECT count(*) FROM playlists) AS "playlists",
      (SELECT count(*) FROM (
        SELECT artist_id FROM tracks
        UNION
        SELECT albums.album_artist_id FROM tracks JOIN albums ON albums.id = tracks.album_id
      )) AS "artists",
      (SELECT count(DISTINCT album_id) FROM tracks) AS "albums",
      (SELECT count(*) FROM tracks) AS "songs",
      (SELECT count(DISTINCT genre_id) FROM tracks) AS "genres",
      (SELECT count(DISTINCT folder_id) FROM tracks) AS "folders",
      (SELECT count(*) FROM favorites JOIN tracks ON tracks.id = favorites.track_id) AS "favorites"`);
