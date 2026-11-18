/**
 * A genre's songs in pages (#601): its header and first page on opening,
 * then the rest of its order as Track ids, a slice at a time, each an index
 * seek on `genre_order` (migration 0038) in any sort. Full song rows are left
 * to what an action needs. Kept free of Expo so the store tests run it against
 * a real SQLite (`testDatabase.ts`).
 */
import {
  songOrderTerms,
  songSpineField,
  type LibrarySongSort,
  type SongOrderField,
} from "@wave/core";
import { sql, type SQL } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import { toSongSummary, type SongSummary } from "./songOrder.ts";

/** Rows the genre screen opens on: a screen and a half (Core's `PAGED_ROWS_LIMITS`). */
const GENRE_FIRST_PAGE = 50;

/** Ids each later read of the order takes: a few milliseconds of SQLite, then a turn back. */
const GENRE_ORDER_SLICE = 500;

/** A genre, as its list and its header show it. */
export interface GenreHeader {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  readonly trackCount: number;
}

/** Where a genre's order goes on: valid only for its genre, its sort and its revision. */
export interface GenreCursor {
  readonly genreId: number;
  readonly sort: string;
  /** The genre's `genre_order_revisions` count when the order was read up to here. */
  readonly revision: number;
  /** The last song's value for each of the sort's order terms. */
  readonly last: readonly (string | number)[];
}

/** A stretch of a genre's order. */
export interface GenreOrderSlice {
  /** Track ids, in the sort's order (the order `sortSongs` gives). */
  readonly ids: readonly number[];
  /** Those of them without a file on this phone. */
  readonly missing: readonly number[];
  /** Each id's sort key's first character, for the A–Z spine; none for the date sorts. */
  readonly letters: readonly string[];
  /** Where the order goes on, or null after its last song. */
  readonly next: GenreCursor | null;
}

/** What the genre screen opens on. */
export interface GenreOpening {
  readonly genre: GenreHeader;
  /** How many times the genre's order had changed: openings alike in it share one whole order. */
  readonly revision: number;
  /** The first page of its songs, as their rows show them. */
  readonly songs: readonly SongSummary[];
  /** The first page's order, and where the rest of it starts. */
  readonly order: GenreOrderSlice;
}

/** Every order term lives in the genre index, including the file and id ties. */
const COLUMNS: Record<SongOrderField, string> = {
  titleSort: "o.title_sort",
  artistSort: "o.artist_sort",
  albumSort: "o.album_sort",
  albumId: "o.album_id",
  discNumber: "o.disc_number",
  trackNumber: "o.track_number",
  addedAt: "o.added_at",
  path: "o.path",
  id: "o.id",
};

/** [sort]'s terms, each field once (song name's ties start by comparing the title again). */
const termsOf = (sort: LibrarySongSort) => {
  const seen = new Set<SongOrderField>();
  return songOrderTerms(sort).filter(({ field }) => !seen.has(field) && seen.add(field));
};

const sortKey = (sort: LibrarySongSort): string =>
  `${sort.key}:${sort.descending ? "desc" : "asc"}`;

const column = (field: SongOrderField): SQL => sql.raw(COLUMNS[field]);
const tuple = (parts: readonly SQL[]): SQL => sql`(${sql.join([...parts], sql`, `)})`;
const values = (last: readonly (string | number)[]): SQL[] => last.map((value) => sql`${value}`);

/** A genre's order revision: how many times its order has changed. */
const revisionOf = (db: LibraryDatabase, genreId: number): number =>
  db.all<{ revision: number }>(
    sql`SELECT revision FROM genre_order_revisions WHERE genre_id = ${genreId}`,
  )[0]?.revision ?? 0;

interface OrderRow extends Record<string, unknown> {
  readonly id: number;
  readonly hasFile: number;
  readonly letter: string;
}

/**
 * Up to [limit] songs of [genreId] in [sort]'s order where [after] holds,
 * with what each row shows when [summaries]. Every term, including the file
 * and id ties, is in the index, so even duplicate-name runs need no sort.
 */
const readOrder = (
  db: LibraryDatabase,
  genreId: number,
  sort: LibrarySongSort,
  after: SQL | undefined,
  limit: number,
  summaries: boolean,
): OrderRow[] => {
  const terms = termsOf(sort);
  const spine = songSpineField(sort);
  const index = sql.raw(`genre_order_${sort.key}_${sort.descending ? "desc" : "asc"}`);
  return db.all<OrderRow>(sql`SELECT o.id AS id, t.path IS NOT NULL AS hasFile,
      ${spine === undefined ? sql`''` : sql`substr(${column(spine)}, 1, 1)`} AS letter,
      ${sql.join(
        terms.map(({ field }, i) => sql`${column(field)} AS ${sql.raw(`k${i}`)}`),
        sql`, `,
      )}
      ${
        summaries
          ? sql`, t.title AS title, t.artist_credit AS artist, t.duration_ms AS durationMs,
            w.thumb_path AS thumbPath, t.path AS path, t.explicit AS explicit,
            t.album_id AS albumId, t.artist_id AS artistId, t.has_lyrics AS hasLyrics,
            (SELECT name FROM genres WHERE genres.id = t.genre_id) AS genre,
            t.track_number AS trackNumber, t.year AS year`
          : sql``
      }
    FROM genre_order o INDEXED BY ${index}
    CROSS JOIN tracks t ON t.id = o.id
    ${summaries ? sql`LEFT JOIN artwork w ON w.hash = t.artwork_hash` : sql``}
    WHERE o.genre_id = ${genreId}${after === undefined ? sql`` : sql` AND ${after}`}
    ORDER BY ${sql.join(
      terms.map(
        ({ field, descending }) => sql`${column(field)} ${sql.raw(descending ? "DESC" : "ASC")}`,
      ),
      sql`, `,
    )}
    LIMIT ${limit}`);
};

/**
 * The songs after [last] in [sort]'s order. Ascending, one seek past the last
 * song's indexed keys. Descending reverses only the first key: the rest of
 * its run first (a seek within it), then the runs below it.
 */
const readAfter = (
  db: LibraryDatabase,
  genreId: number,
  sort: LibrarySongSort,
  last: readonly (string | number)[],
  limit: number,
  summaries: boolean,
): OrderRow[] => {
  const fields = termsOf(sort).map(({ field }) => field);
  const keys = fields.map(column);
  const lastValues = values(last);
  /** Seek past [from]'s position, including file and id ties. */
  const past = (from: number): SQL =>
    sql`${tuple(keys.slice(from))} > ${tuple(lastValues.slice(from))}`;
  if (!sort.descending) return readOrder(db, genreId, sort, past(0), limit, summaries);
  const run = readOrder(
    db,
    genreId,
    sort,
    sql`${keys[0]!} = ${lastValues[0]!} AND ${past(1)}`,
    limit,
    summaries,
  );
  if (run.length >= limit) return run;
  return [
    ...run,
    ...readOrder(
      db,
      genreId,
      sort,
      sql`${keys[0]!} < ${lastValues[0]!}`,
      limit - run.length,
      summaries,
    ),
  ];
};

/** [rows] as a slice of the order, going on from the last of them when [limit] were read. */
const sliceOf = (
  rows: readonly OrderRow[],
  limit: number,
  genreId: number,
  sort: LibrarySongSort,
  revision: number,
): GenreOrderSlice => {
  const spine = songSpineField(sort) !== undefined;
  const ids: number[] = [];
  const missing: number[] = [];
  const letters: string[] = [];
  for (const row of rows) {
    ids.push(row.id);
    if (!row.hasFile) missing.push(row.id);
    if (spine) letters.push(row.letter);
  }
  const lastRow = rows.at(-1);
  const terms = termsOf(sort).length;
  return {
    ids,
    missing,
    letters,
    next:
      lastRow === undefined || rows.length < limit
        ? null
        : {
            genreId,
            sort: sortKey(sort),
            revision,
            last: Array.from({ length: terms }, (_, i) => lastRow[`k${i}`] as string | number),
          },
  };
};

/**
 * What the genre screen opens on: [genreId]'s header and count, and its first
 * page in [sort], read by one index seek; null once the genre is gone.
 */
export const selectGenreOpening = (
  db: LibraryDatabase,
  genreId: number,
  sort: LibrarySongSort,
): GenreOpening | null => {
  // `all`, not `get`: Drizzle's sql.js driver answers `get` of no row with an empty object.
  const [header] = db.all<GenreHeader & { revision: number }>(
    sql`SELECT g.id AS id, g.name AS name, g.sort AS sort,
      (SELECT count(*) FROM tracks WHERE genre_id = g.id) AS trackCount,
      coalesce((SELECT revision FROM genre_order_revisions WHERE genre_id = g.id), 0) AS revision
    FROM genres g WHERE g.id = ${genreId}`,
  );
  if (header === undefined) return null;
  const { revision, ...genre } = header;
  const rows = readOrder(db, genreId, sort, undefined, GENRE_FIRST_PAGE, true);
  return {
    genre,
    revision,
    songs: rows.map((row) =>
      toSongSummary({
        id: row.id,
        title: row.title as string,
        artist: row.artist as string,
        durationMs: row.durationMs as number,
        thumbPath: row.thumbPath as string | null,
        path: row.path as string | null,
        explicit: row.explicit as SongSummary["explicit"],
        albumId: row.albumId as number,
        artistId: row.artistId as number,
        hasLyrics: Boolean(row.hasLyrics),
        genre: row.genre as string | null,
        trackNumber: row.trackNumber as number | null,
        year: row.year as number | null,
      }),
    ),
    order: sliceOf(rows, GENRE_FIRST_PAGE, genreId, sort, revision),
  };
};

/**
 * The next [limit] ids of [genreId]'s order in [sort] from [cursor] (from the
 * start without one). Null when the cursor is another genre's, another sort's,
 * or the genre's order has changed since: the caller starts again rather than
 * stitch two orders together.
 */
export const selectGenreOrderSlice = (
  db: LibraryDatabase,
  genreId: number,
  sort: LibrarySongSort,
  cursor: GenreCursor | null,
  limit: number = GENRE_ORDER_SLICE,
): GenreOrderSlice | null => {
  const revision = revisionOf(db, genreId);
  if (cursor === null)
    return sliceOf(
      readOrder(db, genreId, sort, undefined, limit, false),
      limit,
      genreId,
      sort,
      revision,
    );
  if (cursor.genreId !== genreId || cursor.sort !== sortKey(sort) || cursor.revision !== revision)
    return null;
  return sliceOf(
    readAfter(db, genreId, sort, cursor.last, limit, false),
    limit,
    genreId,
    sort,
    revision,
  );
};
