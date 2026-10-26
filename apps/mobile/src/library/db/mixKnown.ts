/**
 * What Home's mixes read of the songs the owner knows beyond the Library and
 * the play history (Core's `mixKnownSongs`): the YT Music songs streamed
 * before streamed plays were recorded (`schema.streamedSongs`, known songs
 * only) and the playlists' entries other than Library songs. Kept free of
 * Expo for the store tests.
 */
import {
  readPlaylistEntrySong,
  readPlaylistYtSong,
  writePlaylistYtSong,
  type MixPlaylistEntry,
  type StreamedSong,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/**
 * Notes that the owner started streaming [song] at [at]: once more, and first
 * then if never before. The old counter, as Wave kept it before streamed plays
 * were recorded; Wave no longer writes it (the tests seed old databases with it).
 */
export const noteStreamedSong = (db: LibraryDatabase, song: YtAlbumSong, at: number): void => {
  const t = schema.streamedSongs;
  db.insert(t)
    .values({
      videoId: song.videoId,
      song: writePlaylistYtSong(song),
      plays: 1,
      firstPlayedAt: at,
      lastPlayedAt: at,
    })
    .onConflictDoUpdate({
      target: t.videoId,
      set: {
        song: writePlaylistYtSong(song),
        plays: sql`${t.plays} + 1`,
        lastPlayedAt: sql`max(${t.lastPlayedAt}, ${at})`,
        firstPlayedAt: sql`min(${t.firstPlayedAt}, ${at})`,
      },
    })
    .run();
};

/** Every song the owner streamed; one that can't be read is left out. */
export const selectStreamedSongs = (db: LibraryDatabase): StreamedSong[] =>
  db
    .select()
    .from(schema.streamedSongs)
    .all()
    .flatMap((row) => {
      const song = readPlaylistYtSong(row.song);
      return song === null ? [] : [{ song, plays: row.plays, firstPlayedAt: row.firstPlayedAt }];
    });

/**
 * The entries of the owner's playlists (not deleted) that aren't Library
 * songs: YT Music, unsearched and unavailable entries, with when each was
 * added. One that can't be read is left out.
 */
export const selectPlaylistedSongs = (db: LibraryDatabase): MixPlaylistEntry[] =>
  db
    .all<{ song: string; addedAt: number }>(
      sql`SELECT pi.yt_song AS song, pi.added_at AS addedAt
        FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
        WHERE pi.yt_song IS NOT NULL AND NOT pi.deleted AND NOT p.deleted
        ORDER BY pi.id`,
    )
    .flatMap((row) => {
      const song = readPlaylistEntrySong(row.song);
      return song === null ? [] : [{ song, addedAt: row.addedAt }];
    });

/**
 * The videos of the songs the owner knows now beyond the build's view: the
 * songs streamed (since plays are recorded, and by the counter from before),
 * the YT Music entries of playlists, and the downloaded
 * songs (`tracks.video_id`) played or in a playlist. A re-blend leaves the
 * mixes' new songs among them out, with no network (Core's `discoverMixKeep`).
 */
export const selectKnownVideos = (db: LibraryDatabase): string[] =>
  db
    .all<{ videoId: string | null }>(
      sql`SELECT video_id AS videoId FROM streamed_songs
      UNION
      SELECT video_id FROM streamed_totals
      UNION
      SELECT CASE WHEN json_valid(pi.yt_song) THEN json_extract(pi.yt_song, '$.videoId') END
        FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
        WHERE pi.yt_song IS NOT NULL AND NOT pi.deleted AND NOT p.deleted
      UNION
      SELECT t.video_id FROM tracks t
        WHERE t.video_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM play_totals pt WHERE pt.track_id = t.id)
          OR EXISTS (
            SELECT 1 FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
            WHERE pi.track_id = t.id AND NOT pi.deleted AND NOT p.deleted
          )
        )`,
    )
    .flatMap((row) => (typeof row.videoId === "string" && row.videoId !== "" ? [row.videoId] : []));
