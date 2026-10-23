/** Daily mixes page their Library and history by INTEGER PRIMARY KEY, never OFFSET. */
import { readStoredGenres, readPlaylistEntrySong, readPlaylistYtSong } from "@wave/core";
import { gt, sql } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
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
// Count subqueries run for each returned artist; use smaller turns than plain row projections.
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
  ) ORDER BY a.id LIMIT 32`);
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
  FROM play_events WHERE id > ${after} ORDER BY id LIMIT 128`);

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
