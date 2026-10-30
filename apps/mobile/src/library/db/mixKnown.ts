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
import { sql, type SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { VIDEO_PAGE_ROWS, readVideoPages, videoIdsOf, type VideoPage } from "./videoPages.ts";

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

/** Where a walk of the known videos is: which source, and the last key read of it. */
export interface KnownVideosCursor {
  readonly source: number;
  readonly after: string | number;
}

export const KNOWN_VIDEOS_START: KnownVideosCursor = { source: 0, after: "" };

/** Each source of the known videos, walking its key, with its first key. */
const KNOWN_SOURCES: readonly {
  readonly start: string | number;
  readonly page: (after: string | number) => SQL;
}[] = [
  {
    start: "",
    page: (after) => sql`SELECT video_id AS key, video_id AS videoId FROM streamed_songs
      WHERE video_id > ${after} ORDER BY video_id LIMIT ${VIDEO_PAGE_ROWS}`,
  },
  {
    start: "",
    page: (after) => sql`SELECT DISTINCT video_id AS key, video_id AS videoId FROM streamed_totals
      WHERE video_id > ${after} ORDER BY video_id LIMIT ${VIDEO_PAGE_ROWS}`,
  },
  {
    start: 0,
    page: (after) => sql`SELECT pi.id AS key, CASE
        WHEN pi.yt_song IS NOT NULL AND NOT pi.deleted AND NOT p.deleted AND json_valid(pi.yt_song)
        THEN json_extract(pi.yt_song, '$.videoId') END AS videoId
      FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
      WHERE pi.id > ${after} ORDER BY pi.id LIMIT ${VIDEO_PAGE_ROWS}`,
  },
  {
    start: 0,
    page: (after) => sql`SELECT t.id AS key, CASE WHEN EXISTS (
          SELECT 1 FROM play_totals pt WHERE pt.track_id = t.id
        ) OR EXISTS (
          SELECT 1 FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
          WHERE pi.track_id = t.id AND NOT pi.deleted AND NOT p.deleted
        ) THEN t.video_id END AS videoId
      FROM tracks t WHERE t.id > ${after} ORDER BY t.id LIMIT ${VIDEO_PAGE_ROWS}`,
  },
];

/**
 * A page of the videos of the songs the owner knows now beyond the build's
 * view: the songs streamed (since plays are recorded, and by the counter from
 * before), the YT Music entries of playlists, and the downloaded songs
 * (`tracks.video_id`) played or in a playlist. A re-blend leaves the mixes'
 * new songs among them out, with no network (Core's `discoverMixKeep`). A
 * video can come back on several pages. Next page: `next`.
 */
export const selectKnownVideosPage = (
  db: LibraryDatabase,
  { source, after }: KnownVideosCursor,
): VideoPage<KnownVideosCursor> => {
  const rows = db.all<{ key: string | number; videoId: unknown }>(
    KNOWN_SOURCES[source]!.page(after),
  );
  const last = rows.at(-1);
  const following = KNOWN_SOURCES[source + 1];
  return {
    videos: videoIdsOf(rows),
    next:
      last !== undefined
        ? { source, after: last.key }
        : following !== undefined
          ? { source: source + 1, after: following.start }
          : null,
  };
};

/** All the videos the owner knows at once (`selectKnownVideosPage`), each once. */
export const selectKnownVideos = (db: LibraryDatabase): string[] =>
  Effect.runSync(
    readVideoPages(
      KNOWN_VIDEOS_START,
      (cursor) => Effect.sync(() => selectKnownVideosPage(db, cursor)),
      Effect.void,
    ),
  );
