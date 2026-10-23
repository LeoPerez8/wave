/** Bounded, historical taste inputs. Raw cursors advance even when no row decodes. */
import type { TasteHistory } from "@wave/core";
import { sql } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import {
  GRAPH_PAGE_SIZE,
  playEventsPage,
  type GraphPage,
  type GraphPlayCursor,
} from "./artistGraph.ts";

export const tastePlaysPage = (
  db: LibraryDatabase,
  after: GraphPlayCursor,
): GraphPage<TasteHistory["plays"][number], GraphPlayCursor> => {
  const { rows, next } = playEventsPage<{
    id: number;
    trackId: number;
    present: number | null;
    startedAt: number;
    listenedMs: number;
    endReason: TasteHistory["plays"][number]["endReason"];
  }>(
    db,
    after,
    sql`pe.id, pe.track_id AS trackId, t.id AS present,
      pe.started_at AS startedAt, pe.listened_ms AS listenedMs, pe.end_reason AS endReason`,
    sql`LEFT JOIN tracks t ON t.id = pe.track_id`,
  );
  return {
    rows: rows.flatMap(({ present, id: _id, trackId, ...play }) =>
      present === null ? [] : [{ ...play, trackId: String(trackId) }],
    ),
    next,
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

/**
 * A play neither played through nor skipped says nothing to the taste, whatever its listened
 * time (Core's `tastePlaySignal`; pinned by tasteSnapshot.test.ts): an unfinished play's.
 */
const SAYS_NOTHING = (row: "OLD" | "NEW") => `${row}.end_reason NOT IN ('completed', 'skipped')`;

/**
 * What moves the taste revision: a write to what the taste pages and the songs page read
 * (songs, their credits, artists, albums, genres, plays, stars). Playback's own saves (the
 * position, the queue, an unfinished play's progress) and sync's pushed flags don't, so a
 * derivation that walks pages on free turns isn't restarted by music playing.
 */
const TASTE_WRITES: readonly string[] = [
  ...["tracks", "track_artists", "genres"].flatMap((table) =>
    ["INSERT", "UPDATE", "DELETE"].map((write) => `${write} ON ${table}`),
  ),
  "INSERT ON artists",
  "DELETE ON artists",
  "UPDATE OF id, name, sort ON artists",
  "INSERT ON albums",
  "DELETE ON albums",
  "UPDATE OF id ON albums",
  "INSERT ON favorites",
  "DELETE ON favorites",
  "UPDATE OF track_id, changed_at, deleted ON favorites",
  "INSERT ON play_events",
  "DELETE ON play_events",
  // Progress of a play that says nothing either side reads the same profile, whichever
  // listened time a page saw: the row keeps its place in the (started_at, id) walk.
  `UPDATE OF track_id, started_at, listened_ms, end_reason ON play_events WHEN NOT (
    OLD.track_id = NEW.track_id AND OLD.started_at = NEW.started_at
    AND ${SAYS_NOTHING("OLD")} AND ${SAYS_NOTHING("NEW")})`,
];

/**
 * Counts taste writes on this connection, in TEMP objects: nothing in the Library's schema
 * changes, and they go with the connection. Idempotent.
 */
export const watchTasteSources = (db: LibraryDatabase): void => {
  db.run(sql`CREATE TEMP TABLE IF NOT EXISTS taste_writes (n INTEGER NOT NULL)`);
  db.run(sql`INSERT INTO temp.taste_writes (n)
    SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM temp.taste_writes)`);
  TASTE_WRITES.forEach((write, i) => {
    db.run(
      sql.raw(`CREATE TEMP TRIGGER IF NOT EXISTS taste_write_${i} AFTER ${write}
        BEGIN UPDATE taste_writes SET n = n + 1; END`),
    );
  });
};

/** A constant-size stamp: taste writes on this connection, and commits by any other. */
export const tasteRevision = (db: LibraryDatabase): string => {
  const row = db.get<{ writes: number; external: number }>(sql`
    SELECT (SELECT n FROM temp.taste_writes) AS writes, data_version AS external
    FROM pragma_data_version`)!;
  return `${row.writes}:${row.external}`;
};

/** Taste needs artist identity only; no per-artist Library counts or artwork. */
export const tasteArtistsPage = (db: LibraryDatabase, after: number) =>
  db.all<{ id: number; name: string }>(sql`
    SELECT a.id, a.name FROM artists a WHERE a.id > ${after} ORDER BY a.id LIMIT ${GRAPH_PAGE_SIZE}`);
