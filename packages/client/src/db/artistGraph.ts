/** Indexed graph-only projections. No favorites, downloads or SongRow payloads. */
import type { ArtistGraphCatalogEntry, ArtistGraphPlay, CatalogSong } from "@wave/core";
import { sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { readPlaylistYtSong } from "@wave/core";
import { streamedTrack } from "./stats.ts";
import { selectYtArtistSimilar, type YtArtistSimilar } from "./ytArtists.ts";

export const GRAPH_PAGE_SIZE = 128;
export interface GraphPage<A, C> {
  readonly rows: readonly A[];
  readonly next: C | null;
}
export type GraphPlayCursor = readonly [number, number];

/**
 * The plays after [after] in (started_at, id) order, at most a page: [columns] read from
 * `play_events pe` and what [joins] adds, each row with its id and start for the next cursor.
 */
export const playEventsPage = <R extends { readonly id: number; readonly startedAt: number }>(
  db: LibraryDatabase,
  after: GraphPlayCursor,
  columns: SQL,
  joins: SQL,
): GraphPage<R, GraphPlayCursor> => {
  const read = (where: SQL, limit: number) =>
    db.all<R>(sql`SELECT ${columns}
    FROM play_events pe INDEXED BY play_events_started_at_idx ${joins}
    WHERE ${where} ORDER BY pe.started_at, pe.id LIMIT ${limit}`);
  // A row-value predicate only seeks started_at in SQLite, rescanning equal-time prefixes.
  // Equality on the first key makes the implicit rowid a real second seek key.
  const rows = read(sql`pe.started_at = ${after[0]} AND pe.id > ${after[1]}`, GRAPH_PAGE_SIZE);
  if (rows.length < GRAPH_PAGE_SIZE)
    rows.push(...read(sql`pe.started_at > ${after[0]}`, GRAPH_PAGE_SIZE - rows.length));
  const last = rows.at(-1);
  return { rows, next: last === undefined ? null : [last.startedAt, last.id] };
};

/**
 * A play as the graph reads it. A streamed play whose song the Library doesn't
 * have names its artists as its song credits them, still to split with the
 * Library's credits (`streamed`); one the Library has now (`streamedTrack`)
 * names that song's artists, as a Library play does.
 */
export type GraphPlay = ArtistGraphPlay & { readonly streamed?: boolean };

export const graphPlayPage = (
  db: LibraryDatabase,
  after: GraphPlayCursor,
): GraphPage<GraphPlay, GraphPlayCursor> => {
  const { rows, next } = playEventsPage<{
    id: number;
    startedAt: number;
    listenedMs: number;
    endReason: ArtistGraphPlay["endReason"];
    artists: string | null;
    streamed: number;
  }>(
    db,
    after,
    sql`pe.id, pe.started_at AS startedAt, pe.listened_ms AS listenedMs, pe.end_reason AS endReason,
      CASE WHEN t.id IS NOT NULL AND a.id IS NOT NULL AND al.id IS NOT NULL THEN (
        SELECT json_group_array(name) FROM (
          SELECT ar.name FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
          WHERE ta.track_id = t.id ORDER BY ta.position
        )
      ) WHEN t.id IS NULL AND pe.video_id IS NOT NULL THEN coalesce(
        CASE WHEN json_valid(pe.streamed_song) AND json_type(pe.streamed_song, '$.artists') = 'array'
          THEN json_extract(pe.streamed_song, '$.artists') END,
        CASE WHEN json_valid(pe.snapshot) AND json_type(pe.snapshot, '$.artist') = 'text'
          AND json_extract(pe.snapshot, '$.artist') <> ''
          THEN json_array(json_extract(pe.snapshot, '$.artist')) END
      ) END AS artists,
      t.id IS NULL AS streamed`,
    sql`LEFT JOIN tracks t ON t.id = coalesce(pe.track_id, CASE WHEN pe.video_id IS NOT NULL THEN
        ${streamedTrack(sql`pe.video_id`, sql`pe.recording_key`)} END)
      LEFT JOIN artists a ON a.id = t.artist_id
      LEFT JOIN albums al ON al.id = t.album_id`,
  );
  return {
    rows: rows.flatMap((row) => {
      if (row.artists === null) return [];
      const artists = (JSON.parse(row.artists) as unknown[]).filter(
        (name): name is string => typeof name === "string",
      );
      return [
        {
          startedAt: row.startedAt,
          listenedMs: row.listenedMs,
          endReason: row.endReason,
          artists,
          streamed: row.streamed === 1,
        },
      ];
    }),
    next,
  };
};

export const mixCatalogPage = (
  db: LibraryDatabase,
  after: number,
): GraphPage<CatalogSong & { readonly videoId: string }, number> => {
  // Rowid preserves the original unordered table scan's insertion order.
  const rows = db.all<{
    cursor: number;
    videoId: string;
    song: string;
    firstSeenAt: number;
    lastSeenAt: number;
  }>(sql`
    SELECT rowid AS cursor, video_id AS videoId, song, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
    FROM candidate_songs WHERE rowid > ${after} ORDER BY rowid LIMIT ${GRAPH_PAGE_SIZE}`);
  const result: (CatalogSong & { readonly videoId: string })[] = [];
  for (const row of rows) {
    const song = readPlaylistYtSong(row.song);
    if (song === null) continue;
    result.push({
      song,
      videoId: row.videoId,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      radios: [],
    });
  }
  return { rows: result, next: rows.at(-1)?.cursor ?? null };
};

export const graphSimilarPage = (
  db: LibraryDatabase,
  after: string | null,
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
      video_id AS videoId,
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
