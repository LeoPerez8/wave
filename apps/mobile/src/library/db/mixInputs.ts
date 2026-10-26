/** Daily mixes page their Library and history by INTEGER PRIMARY KEY, never OFFSET. */
import {
  readStoredGenres,
  readPlaylistEntrySong,
  readPlaylistYtSong,
  type YtAlbumSong,
} from "@wave/core";
import { gt, sql } from "drizzle-orm";
import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
import { streamedTrack } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import { trackQuery } from "./tracks.ts";
import type { ArtistRow } from "../LibraryStore.ts";

export const mixSongsPage = (
  db: LibraryDatabase,
  after: number,
  { genres = true }: { readonly genres?: boolean } = {},
) => {
  const songs = trackQuery(db).where(gt(tracks.id, after)).orderBy(tracks.id).limit(128).all();
  if (!genres) return songs;
  const end = songs.at(-1)?.id;
  if (end === undefined) return songs;
  const tagged = new Map(
    db
      .all<{ id: number; genres: string | null }>(
        sql`SELECT id, genres FROM tracks WHERE id > ${after} AND id <= ${end} ORDER BY id`,
      )
      .map((row) => [row.id, readStoredGenres(row.genres)]),
  );
  return songs.map((song) => {
    const values = tagged.get(song.id);
    return values === undefined || values.length === 0 ? song : { ...song, genres: values };
  });
};
export const mixArtistsPage = (db: LibraryDatabase, after: number): ArtistRow[] =>
  db.all<ArtistRow>(sql`
  SELECT a.id, a.name, a.sort,
    (SELECT count(*) FROM albums WHERE album_artist_id = a.id) AS albumCount,
    (SELECT count(*) FROM (
      SELECT track_id FROM track_artists WHERE artist_id = a.id
      UNION
      SELECT t.id FROM album_artists aa JOIN tracks t ON t.album_id = aa.album_id WHERE aa.artist_id = a.id
    )) AS trackCount,
    art.thumb_path AS thumbPath, art.path AS artworkPath
  FROM artists a LEFT JOIN artwork art ON art.hash = a.artwork_hash
  WHERE a.id > ${after} AND (
    EXISTS(SELECT 1 FROM track_artists WHERE artist_id = a.id)
    OR EXISTS(SELECT 1 FROM album_artists aa JOIN tracks t ON t.album_id = aa.album_id WHERE aa.artist_id = a.id)
  ) ORDER BY a.id LIMIT 128`);
export interface MixHistoryRow {
  readonly id: number;
  readonly trackId: number;
  readonly recordingKey: string | null;
  readonly counted: number;
  readonly startedAt: number;
  readonly listenedMs: number;
}
export const mixHistoryPage = (db: LibraryDatabase, after: number): MixHistoryRow[] =>
  db.all<MixHistoryRow>(sql`
  SELECT id, track_id AS trackId, recording_key AS recordingKey, counted, started_at AS startedAt, listened_ms AS listenedMs
  FROM play_events WHERE id > ${after} AND track_id IS NOT NULL ORDER BY id LIMIT 128`);

export const mixStreamedPage = (db: LibraryDatabase, after: number) => {
  const rows = db.all<{ cursor: number; song: string; plays: number; firstPlayedAt: number }>(sql`
    SELECT rowid AS cursor, song, plays, first_played_at AS firstPlayedAt
    FROM streamed_songs WHERE rowid > ${after} ORDER BY rowid LIMIT 128`);
  return {
    rows: rows.flatMap((row) => {
      const song = readPlaylistYtSong(row.song);
      return song === null ? [] : [{ song, plays: row.plays, firstPlayedAt: row.firstPlayedAt }];
    }),
    next: rows.at(-1)?.cursor ?? null,
  };
};
/** One video's streamed plays under one recording key, as `streamed_totals` keeps them. */
export interface MixStreamedPlays {
  readonly videoId: string;
  readonly recordingKey: string | null;
  /** The Library song its plays are now (`streamedTrack`), or null. */
  readonly trackId: number | null;
  /** That Library song's artists ([id, sort]), credit order; none without one. */
  readonly credits: readonly (readonly [number, string])[];
  /** Every play, counted or not. */
  readonly plays: number;
  readonly countedPlays: number;
  /** Time listened over its counted plays. */
  readonly countedListenedMs: number;
  /** When its latest counted play started; 0 without one. */
  readonly latestPlayAt: number;
  readonly firstPlayedAt: number;
  /** The song as its latest play queued it, null when no play kept it. */
  readonly song: YtAlbumSong | null;
}

/** The streamed plays from the kept per-video totals, never the play history itself. */
export const mixStreamedPlaysPage = (db: LibraryDatabase, after: number) => {
  const track = streamedTrack(
    sql`streamed_totals.video_id`,
    sql`nullif(streamed_totals.recording_key, '')`,
  );
  const rows = db.all<
    Omit<MixStreamedPlays, "credits" | "song"> & { cursor: number; credits: string }
  >(sql`
    SELECT rowid AS cursor, video_id AS "videoId", nullif(recording_key, '') AS "recordingKey",
      ${track} AS "trackId", plays, counted_plays AS "countedPlays",
      counted_listened_ms AS "countedListenedMs", coalesce(last_counted_at, 0) AS "latestPlayAt",
      (SELECT min(started_at) FROM play_events
        WHERE play_events.video_id = streamed_totals.video_id) AS "firstPlayedAt",
      coalesce((SELECT json_group_array(json_array(ar.id, ar.sort)) FROM (
        SELECT artist_id FROM track_artists WHERE track_artists.track_id = ${track}
        ORDER BY position
      ) c JOIN artists ar ON ar.id = c.artist_id), '[]') AS credits
    FROM streamed_totals WHERE rowid > ${after} ORDER BY rowid LIMIT 128`);
  const songs = streamedSongsOf(
    db,
    rows.map((row) => row.videoId),
  );
  return {
    rows: rows.map(
      ({ cursor: _, credits, ...row }): MixStreamedPlays => ({
        ...row,
        credits: JSON.parse(credits) as [number, string][],
        song: songs.get(row.videoId) ?? null,
      }),
    ),
    next: rows.at(-1)?.cursor ?? null,
  };
};

/**
 * The credits of a page of Library songs and of their albums' artists, as
 * written: what Core's `creditSplitter` splits streamed credits with.
 */
export const mixCreditNamesPage = (db: LibraryDatabase, after: number) => {
  const rows = db.all<{
    id: number;
    credit: string;
    stored: string | null;
    albumCredit: string | null;
    albumStored: string | null;
  }>(sql`
    SELECT t.id, t.artist_credit AS credit, t.artist_credits AS stored,
      al.album_artist_credit AS "albumCredit", al.album_artist_credits AS "albumStored"
    FROM tracks t LEFT JOIN albums al ON al.id = t.album_id
    WHERE t.id > ${after} ORDER BY t.id LIMIT 128`);
  return {
    rows: rows.flatMap((row) => [
      ...readCredits(row.credit, row.stored),
      ...(row.albumCredit === null ? [] : readCredits(row.albumCredit, row.albumStored)),
    ]),
    next: rows.at(-1)?.id ?? null,
  };
};

export const mixPlaylistedPage = (db: LibraryDatabase, after: number) => {
  const rows = db.all<{ id: number; song: string; addedAt: number }>(sql`
    SELECT pi.id, pi.yt_song AS song, pi.added_at AS addedAt
    FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
    WHERE pi.id > ${after} AND pi.yt_song IS NOT NULL AND NOT pi.deleted AND NOT p.deleted
    ORDER BY pi.id LIMIT 128`);
  return {
    rows: rows.flatMap((row) => {
      const song = readPlaylistEntrySong(row.song);
      return song === null ? [] : [{ song, addedAt: row.addedAt }];
    }),
    next: rows.at(-1)?.id ?? null,
  };
};

/** Credits per played track, including deleted songs while their album/artist remains. */
export const mixCreditPage = (db: LibraryDatabase, after: number) =>
  db.all<{ id: number; credits: string }>(sql`
  SELECT pt.track_id AS id, coalesce((SELECT json_group_array(json_array(ar.id, ar.sort)) FROM (
    SELECT artist_id FROM track_artists WHERE track_id = pt.track_id
    UNION ALL SELECT artist_id FROM deleted_track_artists WHERE track_id = pt.track_id
  ) c JOIN artists ar ON ar.id = c.artist_id), '[]') AS credits
  FROM play_totals pt LEFT JOIN tracks t ON t.id = pt.track_id
  JOIN albums al ON al.id = coalesce(t.album_id, pt.album_id)
  WHERE pt.track_id > ${after} ORDER BY pt.track_id LIMIT 128`);
