/** Additional recommendation fields; song/catalog pages are shared with #594. */
import { inArray, sql } from "drizzle-orm";
import { libraryRecommendationTrack } from "../playlistRecommendationTracks.ts";
import { trackQuery, songGenresOf } from "./tracks.ts";
import * as schema from "./schema.ts";
import type { LibraryDatabase } from "./database.ts";
import type { PlaylistRecommendationFeedback } from "@wave/core";

export const recommendationFlagsPage = (db: LibraryDatabase, after: number) =>
  db.all<{ id: number; videoId: string | null; favorite: number }>(sql`
    SELECT t.id, t.video_id AS videoId,
      EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = t.id AND NOT f.deleted) AS favorite
    FROM tracks t WHERE t.id > ${after} ORDER BY t.id LIMIT 128`);

export const recommendationPendingPage = (db: LibraryDatabase, after: number) =>
  db.all<{ cursor: number; videoId: string }>(sql`
    SELECT rowid AS cursor, video_id AS videoId FROM pending_favorites
    WHERE rowid > ${after} ORDER BY rowid LIMIT 128`);

/** Raw cursor advances even across missing tracks and unreadable stored entries. */
export type RecommendationEntryCursor = readonly [string, string] | null;
export const recommendationEntriesPage = (
  db: LibraryDatabase,
  id: number,
  after: RecommendationEntryCursor,
  includeTracks = false,
) => {
  if (db.get(sql`SELECT 1 FROM playlists WHERE id = ${id} AND NOT deleted`) === undefined)
    throw new Error("The playlist no longer exists");
  const entries = db.all<{
    id: number;
    trackId: number | null;
    song: string | null;
    orderKey: string;
    syncId: string;
    addedAt: number;
  }>(sql`
    SELECT id, track_id AS trackId, yt_song AS song, order_key AS orderKey, sync_id AS syncId,
      added_at AS addedAt
    FROM playlist_items WHERE playlist_id = ${id} AND ${after === null ? sql`1` : sql`(order_key, sync_id) > (${after[0]}, ${after[1]})`} AND NOT deleted
    ORDER BY order_key, sync_id LIMIT 128`);
  // Only the playlist's current page is read on a cold recommendation. Never page the Library here.
  const ids = includeTracks ? entries.flatMap((entry) => entry.trackId ?? []) : [];
  const rows = ids.length === 0 ? [] : trackQuery(db).where(inArray(schema.tracks.id, ids)).all();
  const facts = new Map(
    ids.length === 0
      ? []
      : db
          .all<{
            id: number;
            videoId: string | null;
            favorite: number;
            genres: string | null;
            artists: string;
          }>(
            sql`SELECT t.id, t.video_id AS videoId, t.genres,
    EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = t.id AND NOT f.deleted) AS favorite,
    (SELECT json_group_array(name) FROM (
      SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
      WHERE ta.track_id = t.id ORDER BY ta.position)) AS artists
    FROM tracks t WHERE t.id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
          )
          .map((row) => [row.id, row]),
  );
  const local = new Map(
    rows.map((row) => {
      const fact = facts.get(row.id)!;
      const names = JSON.parse(fact.artists) as string[];
      const track = libraryRecommendationTrack(
        row,
        new Map(row.artistIds.map((artistId, i) => [artistId, names[i]!])),
        {
          favorite: fact.favorite === 1,
          downloaded: fact.videoId !== null && row.path !== null,
          videoId: fact.videoId ?? "",
          genres: songGenresOf(fact)[0]?.genres,
        },
      );
      return [row.id, { track }] as const;
    }),
  );
  return entries.map((entry) => ({ ...entry, local: local.get(entry.trackId ?? -1) }));
};
export const recommendationFeedbackPage = (db: LibraryDatabase, id: number, after: string | null) =>
  db
    .all<{ offerKey: string; track: string; value: -1 | 1 }>(
      sql`
    SELECT offer_key AS offerKey, track, value FROM playlist_recommendation_feedback
    WHERE playlist_id = ${id} AND ${after === null ? sql`1` : sql`offer_key > ${after}`} ORDER BY offer_key LIMIT 128`,
    )
    .map((row) => ({
      ...row,
      track: JSON.parse(row.track) as PlaylistRecommendationFeedback["track"],
    }));
