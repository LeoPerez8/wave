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
 * credited to them, as Library › Artists lists them); songs; and starred songs. Tombstones (removed playlists and stars) aren't counted.
 */
export const libraryCounts = (db: LibraryDatabase): LibraryCounts =>
  db.get<LibraryCounts>(sql`
    SELECT
      (SELECT count(*) FROM playlists WHERE NOT deleted) AS "playlists",
      (SELECT count(DISTINCT artist_id) FROM (${CREDITED_SONGS})) AS "artists",
      (SELECT count(DISTINCT album_id) FROM tracks) AS "albums",
      (SELECT count(*) FROM tracks) AS "songs",
      (SELECT count(DISTINCT genre_id) FROM tracks) AS "genres",
      (SELECT count(*) FROM favorites JOIN tracks ON tracks.id = favorites.track_id
        WHERE NOT favorites.deleted) AS "favorites"`);

/** How big the Library is, as a performance run records it (docs/performance/README.md). */
export interface LibraryScale {
  readonly tracks: number;
  /** Playlists the owner sees (not tombstones). */
  readonly playlists: number;
  /** Entries in those playlists, Library songs and YT Music songs alike. */
  readonly playlistItems: number;
  /** Entries in the biggest of them. */
  readonly largestPlaylist: number;
  /** Rows in the play history, imported plays included. */
  readonly playEvents: number;
}

/** The Library's `LibraryScale`, for the perf build's run metadata. */
export const libraryScale = (db: LibraryDatabase): LibraryScale =>
  db.get<LibraryScale>(sql`
    WITH sizes AS (
      SELECT count(playlist_items.id) AS size FROM playlists
      LEFT JOIN playlist_items
        ON playlist_items.playlist_id = playlists.id AND NOT playlist_items.deleted
      WHERE NOT playlists.deleted
      GROUP BY playlists.id)
    SELECT
      (SELECT count(*) FROM tracks) AS "tracks",
      (SELECT count(*) FROM sizes) AS "playlists",
      (SELECT coalesce(sum(size), 0) FROM sizes) AS "playlistItems",
      (SELECT coalesce(max(size), 0) FROM sizes) AS "largestPlaylist",
      (SELECT count(*) FROM play_events) AS "playEvents"`);

/**
 * Counts the songs each Library entry's menu queues (Core `sectionSongs`)
 * without loading them: every track for Songs, Albums and Artists (a song
 * under two artists plays once); tracks with a genre; every playlist
 * item that is a Library song (a song in two playlists, or twice in one, plays
 * each time; YT Music entries aren't queued from here); starred songs.
 */
export const sectionSongCounts = (db: LibraryDatabase): LibraryCounts =>
  db.get<LibraryCounts>(sql`
    SELECT
      (SELECT count(*) FROM playlist_items
        JOIN tracks ON tracks.id = playlist_items.track_id
        JOIN playlists ON playlists.id = playlist_items.playlist_id
        WHERE NOT playlist_items.deleted AND NOT playlists.deleted) AS "playlists",
      (SELECT count(*) FROM tracks) AS "artists",
      (SELECT count(*) FROM tracks) AS "albums",
      (SELECT count(*) FROM tracks) AS "songs",
      (SELECT count(*) FROM tracks WHERE genre_id IS NOT NULL) AS "genres",
      (SELECT count(*) FROM favorites JOIN tracks ON tracks.id = favorites.track_id
        WHERE NOT favorites.deleted) AS "favorites"`);
