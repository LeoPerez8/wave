/** Bounded, historical taste inputs. Raw cursors advance even when no row decodes. */
import type { TasteHistory } from "@wave/core";
import { sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { GRAPH_PAGE_SIZE, type GraphPage, type GraphPlayCursor } from "./artistGraph.ts";

export const tastePlaysPage = (
  db: LibraryDatabase,
  after: GraphPlayCursor,
): GraphPage<TasteHistory["plays"][number], GraphPlayCursor> => {
  const read = (where: SQL, limit: number) =>
    db.all<{
      id: number;
      trackId: number;
      present: number | null;
      startedAt: number;
      listenedMs: number;
      endReason: TasteHistory["plays"][number]["endReason"];
    }>(sql`SELECT pe.id, pe.track_id AS trackId, t.id AS present,
      pe.started_at AS startedAt, pe.listened_ms AS listenedMs, pe.end_reason AS endReason
    FROM play_events pe INDEXED BY play_events_started_at_idx
    LEFT JOIN tracks t ON t.id = pe.track_id
    WHERE ${where} ORDER BY pe.started_at, pe.id LIMIT ${limit}`);
  const rows = read(sql`pe.started_at = ${after[0]} AND pe.id > ${after[1]}`, GRAPH_PAGE_SIZE);
  if (rows.length < GRAPH_PAGE_SIZE)
    rows.push(...read(sql`pe.started_at > ${after[0]}`, GRAPH_PAGE_SIZE - rows.length));
  const last = rows.at(-1);
  return {
    rows: rows.flatMap(({ present, id: _id, trackId, ...play }) =>
      present === null ? [] : [{ ...play, trackId: String(trackId) }],
    ),
    next: last === undefined ? null : [last.startedAt, last.id],
  };
};

export const tasteFavoritesPage = (
  db: LibraryDatabase,
  after: number,
): GraphPage<TasteHistory["favorites"][number], number> => {
  // Retain the historical table scan order, including sparse/deleted raw pages.
  const rows = db.all<{ cursor: number; trackId: number; changedAt: number; deleted: number }>(sql`
    SELECT rowid AS cursor, track_id AS trackId, changed_at AS changedAt, deleted
    FROM favorites WHERE rowid > ${after} ORDER BY rowid LIMIT ${GRAPH_PAGE_SIZE}`);
  return {
    rows: rows.flatMap(({ trackId, changedAt, deleted }) =>
      deleted ? [] : [{ trackId: String(trackId), changedAt }],
    ),
    next: rows.at(-1)?.cursor ?? null,
  };
};

export const tasteDownloadsPage = (
  db: LibraryDatabase,
  after: number,
): GraphPage<TasteHistory["downloads"][number], number> => {
  const rows = db.all<{ id: number; downloadedAt: number | null }>(sql`
    SELECT id, CASE WHEN video_id IS NOT NULL AND path IS NOT NULL THEN min(added_at, modified_at) END AS downloadedAt
    FROM tracks WHERE id > ${after} ORDER BY id LIMIT ${GRAPH_PAGE_SIZE}`);
  return {
    rows: rows.flatMap(({ id, downloadedAt }) =>
      downloadedAt === null ? [] : [{ trackId: String(id), downloadedAt }],
    ),
    next: rows.at(-1)?.id ?? null,
  };
};

/** Taste needs artist identity only; no per-artist Library counts or artwork. */
export const tasteArtistsPage = (db: LibraryDatabase, after: number) =>
  db.all<{ id: number; name: string }>(sql`
    SELECT a.id, a.name FROM artists a WHERE a.id > ${after} ORDER BY a.id LIMIT ${GRAPH_PAGE_SIZE}`);
