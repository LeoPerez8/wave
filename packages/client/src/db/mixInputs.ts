/**
 * Daily mixes page their Library and history by INTEGER PRIMARY KEY, never
 * OFFSET. Home's mix build reads each source whole, in one read off the JS
 * thread (#1348, #1351): the readers below without `Page` give the same rows
 * in the same order as every page of their page reader.
 */
import {
  readStoredGenres,
  readPlaylistEntrySong,
  readPlaylistYtSong,
  type YtAlbumSong,
} from "@wave/core";
import { gt, sql, type SQL } from "drizzle-orm";
import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
import { streamedTrack } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import { trackQuery } from "./tracks.ts";
import type { ArtistRow } from "../types.ts";

/** Rows of a page reader's page; null reads past the cursor to the end. */
type Rows = number | null;
const limited = (rows: Rows): SQL => (rows === null ? sql`` : sql`LIMIT ${rows}`);

export const mixSongsPage = (
  db: LibraryDatabase,
  after: number,
  { genres = true }: { readonly genres?: boolean } = {},
  rows: Rows = 128,
) => {
  const query = trackQuery(db).where(gt(tracks.id, after)).orderBy(tracks.id);
  const songs = (rows === null ? query : query.limit(rows)).all();
  if (!genres) return songs;
  const end = songs.at(-1)?.id;
  if (end === undefined) return songs;
  const tagged = new Map(
    db
      .all<{ id: number; genres: string | null }>(
        rows === null
          ? sql`SELECT id, genres FROM tracks WHERE genres IS NOT NULL ORDER BY id`
          : sql`SELECT id, genres FROM tracks WHERE id > ${after} AND id <= ${end} ORDER BY id`,
      )
      .map((row) => [row.id, readStoredGenres(row.genres)]),
  );
  return songs.map((song) => {
    const values = tagged.get(song.id);
    return values === undefined || values.length === 0 ? song : { ...song, genres: values };
  });
};
/** Every Library song, as `mixSongsPage` gives them page by page. */
export const mixSongs = (db: LibraryDatabase, options: { readonly genres?: boolean } = {}) =>
  mixSongsPage(db, 0, options, null);
export const mixArtistsPage = (
  db: LibraryDatabase,
  after: number,
  rows: Rows = 128,
): ArtistRow[] =>
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
  ) ORDER BY a.id ${limited(rows)}`);
/** Every artist with a song, as `mixArtistsPage` gives them page by page. */
export const mixArtists = (db: LibraryDatabase): ArtistRow[] => mixArtistsPage(db, 0, null);
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

/** A Library song's counted plays that started by a moment, as the play history adds them up. */
export interface MixPlayTotal {
  readonly trackId: number;
  readonly countedPlays: number;
  readonly listenedMs: number;
  readonly latestPlayAt: number;
}

/**
 * Each song's counted plays started by [now], summed by SQLite over
 * `mixHistoryPage`'s rows instead of walked in JS: one row per song, by id.
 */
export const mixPlayTotals = (db: LibraryDatabase, now: number): MixPlayTotal[] =>
  db.all<MixPlayTotal>(sql`
  SELECT track_id AS trackId, count(*) AS countedPlays, sum(listened_ms) AS listenedMs,
    max(started_at) AS latestPlayAt
  FROM play_events WHERE track_id IS NOT NULL AND counted AND started_at <= ${now}
  GROUP BY track_id ORDER BY track_id`);

/** The recording keys of `mixHistoryPage`'s rows, each once. */
export const mixPlayedRecordingKeys = (db: LibraryDatabase): string[] =>
  db
    .all<{ key: string }>(
      sql`SELECT DISTINCT recording_key AS key FROM play_events
        WHERE track_id IS NOT NULL AND recording_key IS NOT NULL`,
    )
    .map((row) => row.key);

export const mixStreamedPage = (db: LibraryDatabase, after: number, limit: Rows = 128) => {
  const rows = db.all<{ cursor: number; song: string; plays: number; firstPlayedAt: number }>(sql`
    SELECT rowid AS cursor, song, plays, first_played_at AS firstPlayedAt
    FROM streamed_songs WHERE rowid > ${after} ORDER BY rowid ${limited(limit)}`);
  return {
    rows: rows.flatMap((row) => {
      const song = readPlaylistYtSong(row.song);
      return song === null ? [] : [{ song, plays: row.plays, firstPlayedAt: row.firstPlayedAt }];
    }),
    next: limit === null ? null : (rows.at(-1)?.cursor ?? null),
  };
};
/** Every song streamed before streamed plays were recorded, as `mixStreamedPage` pages them. */
export const mixStreamed = (db: LibraryDatabase) => mixStreamedPage(db, 0, null).rows;
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
export const mixStreamedPlaysPage = (db: LibraryDatabase, after: number, limit: Rows = 128) => {
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
    FROM streamed_totals WHERE rowid > ${after} ORDER BY rowid ${limited(limit)}`);
  const songs = streamedSongsOf(
    db,
    rows.map((row) => row.videoId),
  );
  return {
    rows: rows.map((row): MixStreamedPlays => ({
      videoId: row.videoId,
      recordingKey: row.recordingKey,
      trackId: row.trackId,
      credits: JSON.parse(row.credits) as [number, string][],
      plays: row.plays,
      countedPlays: row.countedPlays,
      countedListenedMs: row.countedListenedMs,
      latestPlayAt: row.latestPlayAt,
      firstPlayedAt: row.firstPlayedAt,
      song: songs.get(row.videoId) ?? null,
    })),
    next: limit === null ? null : (rows.at(-1)?.cursor ?? null),
  };
};
/** Every video's kept streamed plays, as `mixStreamedPlaysPage` pages them. */
export const mixStreamedPlays = (db: LibraryDatabase): MixStreamedPlays[] =>
  mixStreamedPlaysPage(db, 0, null).rows;

/**
 * The credits of a page of Library songs and of their albums' artists, as
 * written: what Core's `creditSplitter` splits streamed credits with.
 */
export const mixCreditNamesPage = (db: LibraryDatabase, after: number, limit: Rows = 128) => {
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
    WHERE t.id > ${after} ORDER BY t.id ${limited(limit)}`);
  return {
    rows: rows.flatMap((row) => [
      ...readCredits(row.credit, row.stored),
      ...(row.albumCredit === null ? [] : readCredits(row.albumCredit, row.albumStored)),
    ]),
    next: limit === null ? null : (rows.at(-1)?.id ?? null),
  };
};
/** Every Library song's credits, as `mixCreditNamesPage` pages them. */
export const mixCreditNames = (db: LibraryDatabase): string[] =>
  mixCreditNamesPage(db, 0, null).rows;

export const mixPlaylistedPage = (db: LibraryDatabase, after: number, limit: Rows = 128) => {
  const rows = db.all<{ id: number; song: string; addedAt: number }>(sql`
    SELECT pi.id, pi.yt_song AS song, pi.added_at AS addedAt
    FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
    WHERE pi.id > ${after} AND pi.yt_song IS NOT NULL AND NOT pi.deleted AND NOT p.deleted
    ORDER BY pi.id ${limited(limit)}`);
  return {
    rows: rows.flatMap((row) => {
      const song = readPlaylistEntrySong(row.song);
      return song === null ? [] : [{ song, addedAt: row.addedAt }];
    }),
    next: limit === null ? null : (rows.at(-1)?.id ?? null),
  };
};
/** Every playlist entry that isn't a Library song, as `mixPlaylistedPage` pages them. */
export const mixPlaylisted = (db: LibraryDatabase) => mixPlaylistedPage(db, 0, null).rows;

/** Credits per played track, including deleted songs while their album/artist remains. */
export const mixCreditPage = (db: LibraryDatabase, after: number, limit: Rows = 128) =>
  db.all<{ id: number; credits: string }>(sql`
  SELECT pt.track_id AS id, coalesce((SELECT json_group_array(json_array(ar.id, ar.sort)) FROM (
    SELECT artist_id FROM track_artists WHERE track_id = pt.track_id
    UNION ALL SELECT artist_id FROM deleted_track_artists WHERE track_id = pt.track_id
  ) c JOIN artists ar ON ar.id = c.artist_id), '[]') AS credits
  FROM play_totals pt LEFT JOIN tracks t ON t.id = pt.track_id
  JOIN albums al ON al.id = coalesce(t.album_id, pt.album_id)
  WHERE pt.track_id > ${after} ORDER BY pt.track_id ${limited(limit)}`);
/** Every played song's credits, as `mixCreditPage` pages them. */
export const mixCredits = (db: LibraryDatabase) => mixCreditPage(db, 0, null);
