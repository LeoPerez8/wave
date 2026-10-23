/** Additional recommendation fields; song/catalog pages are shared with #594. */
import { sql } from "drizzle-orm";
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
) => {
  if (db.get(sql`SELECT 1 FROM playlists WHERE id = ${id} AND NOT deleted`) === undefined)
    throw new Error("The playlist no longer exists");
  return db.all<{
    id: number;
    trackId: number | null;
    song: string | null;
    orderKey: string;
    syncId: string;
  }>(sql`
    SELECT id, track_id AS trackId, yt_song AS song, order_key AS orderKey, sync_id AS syncId
    FROM playlist_items WHERE playlist_id = ${id} AND ${after === null ? sql`1` : sql`(order_key, sync_id) > (${after[0]}, ${after[1]})`} AND NOT deleted
    ORDER BY order_key, sync_id LIMIT 128`);
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
