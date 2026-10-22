/** Indexed graph-only projections. No favorites, downloads or SongRow payloads. */
import type { ArtistGraphCatalogEntry, ArtistGraphPlay, CatalogSong } from "@wave/core";
import { sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { readPlaylistYtSong } from "@wave/core";
import { selectYtArtistSimilar, type YtArtistSimilar } from "./ytArtists.ts";

export const GRAPH_PAGE_SIZE = 128;
export interface GraphPage<A, C> {
  readonly rows: readonly A[];
  readonly next: C | null;
}
export type GraphPlayCursor = readonly [number, number];
export const graphPlayPage = (
  db: LibraryDatabase,
  after: GraphPlayCursor,
): GraphPage<ArtistGraphPlay, GraphPlayCursor> => {
  const read = (where: SQL, limit: number) =>
    db.all<{
      id: number;
      startedAt: number;
      listenedMs: number;
      endReason: ArtistGraphPlay["endReason"];
      artists: string | null;
    }>(sql`
    SELECT pe.id, pe.started_at AS startedAt, pe.listened_ms AS listenedMs, pe.end_reason AS endReason,
      CASE WHEN t.id IS NOT NULL AND a.id IS NOT NULL AND al.id IS NOT NULL THEN (
        SELECT json_group_array(name) FROM (
          SELECT ar.name FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
          WHERE ta.track_id = t.id ORDER BY ta.position
        )
      ) END AS artists
    FROM play_events pe INDEXED BY play_events_started_at_idx
      LEFT JOIN tracks t ON t.id = pe.track_id
      LEFT JOIN artists a ON a.id = t.artist_id
      LEFT JOIN albums al ON al.id = t.album_id
    WHERE ${where}
    ORDER BY pe.started_at, pe.id LIMIT ${limit}`);
  // A row-value predicate only seeks started_at in SQLite, rescanning equal-time prefixes.
  // Equality on the first key makes the implicit rowid a real second seek key.
  const rows = read(sql`pe.started_at = ${after[0]} AND pe.id > ${after[1]}`, GRAPH_PAGE_SIZE);
  if (rows.length < GRAPH_PAGE_SIZE)
    rows.push(...read(sql`pe.started_at > ${after[0]}`, GRAPH_PAGE_SIZE - rows.length));
  const last = rows.at(-1);
  return {
    rows: rows.flatMap((row) =>
      row.artists === null
        ? []
        : [
            {
              startedAt: row.startedAt,
              listenedMs: row.listenedMs,
              endReason: row.endReason,
              artists: JSON.parse(row.artists) as string[],
            },
          ],
    ),
    next: last === undefined ? null : [last.startedAt, last.id],
  };
};

export const mixCatalogPage = (
  db: LibraryDatabase,
  after: number,
): GraphPage<CatalogSong, number> => {
  // Rowid preserves the original unordered table scan's insertion order.
  const rows = db.all<{
    cursor: number;
    song: string;
    firstSeenAt: number;
    lastSeenAt: number;
  }>(sql`
    SELECT rowid AS cursor, song, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
    FROM candidate_songs WHERE rowid > ${after} ORDER BY rowid LIMIT ${GRAPH_PAGE_SIZE}`);
  const result: CatalogSong[] = [];
  for (const row of rows) {
    const song = readPlaylistYtSong(row.song);
    if (song === null) continue;
    result.push({ song, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, radios: [] });
  }
  return { rows: result, next: rows.at(-1)?.cursor ?? null };
};

export const graphSimilarPage = (
  db: LibraryDatabase,
  after: string,
): GraphPage<YtArtistSimilar, string> => selectYtArtistSimilar(db, after, GRAPH_PAGE_SIZE);

export const graphRadioPage = (
  db: LibraryDatabase,
  after: number,
): GraphPage<CatalogSong["radios"][number] & { readonly videoId: string }, number> => {
  const rows = db.all<{
    cursor: number;
    videoId: string;
    seed: string;
    seedName: string;
    lastSeenAt: number;
  }>(sql`
    SELECT rowid AS cursor, video_id AS videoId, seed_key AS seed, seed_name AS seedName, last_seen_at AS lastSeenAt
    FROM candidate_radios WHERE rowid > ${after} ORDER BY rowid LIMIT ${GRAPH_PAGE_SIZE}`);
  return { rows, next: rows.at(-1)?.cursor ?? null };
};

/** Validate the historical song format in SQL, returning only artist names and the radio lookup id. */
export const graphCatalogPage = (
  db: LibraryDatabase,
  after: number,
): GraphPage<ArtistGraphCatalogEntry & { readonly videoId: string }, number> => {
  const rows = db.all<{ cursor: number; videoId: string; artists: string | null }>(sql`
    SELECT rowid AS cursor,
      CASE WHEN json_valid(song) THEN json_extract(song, '$.videoId') END AS videoId,
      CASE WHEN json_valid(song) THEN CASE WHEN
        json_type(song) = 'object' AND json_type(song, '$.videoId') = 'text' AND json_extract(song, '$.videoId') <> ''
        AND json_type(song, '$.title') = 'text' AND json_type(song, '$.artists') = 'array'
        AND NOT EXISTS(SELECT 1 FROM json_each(song, '$.artists') WHERE type <> 'text')
        AND json_type(song, '$.album') IN ('text','null')
        AND json_type(song, '$.artworkUrl') IN ('text','null')
        AND json_type(song, '$.durationMs') IN ('integer','real','null')
      THEN json_extract(song, '$.artists') END END AS artists
    FROM candidate_songs WHERE rowid > ${after} ORDER BY rowid LIMIT ${GRAPH_PAGE_SIZE}`);
  return {
    rows: rows.flatMap((row) =>
      row.artists === null
        ? []
        : [
            {
              videoId: row.videoId,
              song: { artists: JSON.parse(row.artists) as string[] },
              radios: [],
            },
          ],
    ),
    next: rows.at(-1)?.cursor ?? null,
  };
};
