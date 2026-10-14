/**
 * How many items each Library entry holds, for the counts on the Library tab,
 * and how many songs, for the heading of its long-press menu. Kept free of Expo so the store tests run it against a real SQLite
 * (`testDatabase.ts`).
 */
import type { LibrarySectionSlug } from "@wave/core";
import { sql } from "drizzle-orm";

import { CREDITED_SONGS } from "./artists.ts";
import type { LibraryDatabase } from "./database.ts";

/** One count per Library entry, keyed by its section slug. */
export type LibraryCounts = Readonly<Record<LibrarySectionSlug, number>>;

/**
 * Counts what each Library list shows: every playlist (empty ones too); artists,
 * albums and genres with songs (an artist counts through every song
 * credited to them, as Library › Artists lists them); songs; and starred songs.
 */
export const libraryCounts = (db: LibraryDatabase): LibraryCounts =>
  db.get<LibraryCounts>(sql`
    SELECT
      (SELECT count(*) FROM playlists) AS "playlists",
      (SELECT count(DISTINCT artist_id) FROM (${CREDITED_SONGS})) AS "artists",
      (SELECT count(DISTINCT album_id) FROM tracks) AS "albums",
      (SELECT count(*) FROM tracks) AS "songs",
      (SELECT count(DISTINCT genre_id) FROM tracks) AS "genres",
      (SELECT count(*) FROM favorites JOIN tracks ON tracks.id = favorites.track_id) AS "favorites"`);

/**
 * Counts the songs each Library entry's menu queues (Core `sectionSongs`)
 * without loading them: every track for Songs, Albums and Artists (a song
 * under two artists plays once); tracks with a genre; every playlist
 * item (a song in two playlists, or twice in one, plays each time); starred songs.
 */
export const sectionSongCounts = (db: LibraryDatabase): LibraryCounts =>
  db.get<LibraryCounts>(sql`
    SELECT
      (SELECT count(*) FROM playlist_items) AS "playlists",
      (SELECT count(*) FROM tracks) AS "artists",
      (SELECT count(*) FROM tracks) AS "albums",
      (SELECT count(*) FROM tracks) AS "songs",
      (SELECT count(*) FROM tracks WHERE genre_id IS NOT NULL) AS "genres",
      (SELECT count(*) FROM favorites JOIN tracks ON tracks.id = favorites.track_id) AS "favorites"`);
