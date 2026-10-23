/** Indexed, bounded genre reads. Full SongRows belong to actions, never opening. */
import { canFixSong, songOrderTerms, songSpineField, type LibrarySongSort, type SongOrderField } from "@wave/core";
import { sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import type { GenreRow } from "../LibraryStore.ts";
import type { SongSummary } from "./songOrder.ts";

export const GENRE_PAGE_SIZE = 50;
export interface GenreCursor {
  readonly genreId: number;
  readonly sort: string;
  readonly revision: number;
  readonly values: readonly (string | number)[];
}
export interface GenreOrderRow {
  readonly id: number;
  readonly hasFile: boolean;
  readonly letter: string;
}
export interface GenreBrowseRow extends GenreOrderRow { readonly summary: SongSummary }
export interface GenrePage<R extends GenreOrderRow = GenreBrowseRow> {
  readonly rows: readonly R[];
  readonly next: GenreCursor | null;
  /** A mutation invalidated the cursor: discard the accumulated order and restart. */
  readonly stale: boolean;
}
export interface GenreOpening {
  readonly genre: GenreRow;
  readonly revision: number;
  readonly page: GenrePage;
}
const columns: Record<SongOrderField, string> = {
  titleSort: "title_sort", artistSort: "artist_sort", albumSort: "album_sort", albumId: "album_id",
  discNumber: "disc_number", trackNumber: "track_number", addedAt: "added_at", path: "path", id: "id",
};
const sortKey = (sort: LibrarySongSort) => `${sort.key}:${sort.descending}`;
const termsOf = (sort: LibrarySongSort) => {
  const seen = new Set<string>();
  return songOrderTerms(sort).filter(term => {
    if (seen.has(term.field)) return false;
    seen.add(term.field); return true;
  });
};
const column = (field: SongOrderField) => sql.raw(`o.${columns[field]}`);
const revisionOf = (db: LibraryDatabase) => db.get<{ revision: number }>(sql`SELECT revision FROM genre_order_state WHERE id = 1`).revision;

/** Header/count only, including the generation pages must belong to. */
export const selectGenreHeader = (db: LibraryDatabase, id: number): (GenreRow & { revision: number }) | null =>
  db.get<GenreRow & { revision: number }>(sql`SELECT g.id, g.name, g.sort,
    (SELECT count(*) FROM tracks WHERE genre_id = g.id) AS trackCount,
    (SELECT revision FROM genre_order_state WHERE id = 1) AS revision
    FROM genres g WHERE g.id = ${id}`) ?? null;

interface RawRow extends Record<string, unknown> {
  id: number; path: string; letter: string;
}
/** One seek, with a lightweight row projection only when browsing needs it. */
const read = (db: LibraryDatabase, genreId: number, sort: LibrarySongSort, predicate: SQL | undefined,
  limit: number, browse: boolean): RawRow[] => {
  const terms = termsOf(sort);
  const spine = songSpineField(sort);
  const keyColumns = terms.map((term, i) => sql`${column(term.field)} AS ${sql.raw(`k${i}`)}`);
  return db.all<RawRow>(sql`SELECT o.id, o.path,
    ${spine === undefined ? sql`''` : sql`substr(${column(spine)}, 1, 1)`} AS letter,
    ${sql.join(keyColumns, sql`, `)}
    ${browse ? sql`, t.title, t.artist_credit AS artist, t.duration_ms AS durationMs,
      w.thumb_path AS thumbPath, t.explicit, t.album_id AS albumId, t.artist_id AS artistId,
      t.has_lyrics AS hasLyrics, g.name AS genre, t.track_number AS trackNumber, t.year` : sql``}
    FROM genre_order o INDEXED BY ${sql.raw(`genre_order_${sort.key}_${sort.descending ? "desc" : "asc"}`)}
    ${browse ? sql`JOIN tracks t ON t.id = o.id LEFT JOIN artwork w ON w.hash = t.artwork_hash
      LEFT JOIN genres g ON g.id = o.genre_id` : sql``}
    WHERE o.genre_id = ${genreId} ${predicate === undefined ? sql`` : sql`AND ${predicate}`}
    ORDER BY ${sql.join(terms.map(t => sql`${column(t.field)} ${sql.raw(t.descending ? "DESC" : "ASC")}`), sql`, `)}
    LIMIT ${limit}`);
};
const tuple = (parts: readonly SQL[]) => sql`(${sql.join(parts, sql`, `)})`;

/** Seek pages use a generation, genre and sort scoped cursor; never OFFSET. */
export const selectGenrePage = <B extends boolean = true>(db: LibraryDatabase, genreId: number,
  sort: LibrarySongSort, cursor: GenreCursor | null = null, browse: B = true as B,
  knownRevision?: number): GenrePage<B extends true ? GenreBrowseRow : GenreOrderRow> => {
  const revision = knownRevision ?? revisionOf(db);
  if (cursor !== null && (cursor.genreId !== genreId || cursor.sort !== sortKey(sort) || cursor.revision !== revision))
    return { rows: [], next: null, stale: true };
  const terms = termsOf(sort);
  let raw: RawRow[];
  if (cursor === null) raw = read(db, genreId, sort, undefined, GENRE_PAGE_SIZE, browse);
  else {
    const keys = terms.map(t => column(t.field));
    const values = cursor.values.map(v => sql`${v}`);
    if (!sort.descending) raw = read(db, genreId, sort, sql`${tuple(keys)} > ${tuple(values)}`, GENRE_PAGE_SIZE, browse);
    else {
      // Separate same-primary ties and smaller primary values: both are index seeks,
      // including huge tie groups. A mixed-direction OR would scan the genre prefix.
      raw = read(db, genreId, sort, sql`${keys[0]!} = ${values[0]!} AND ${tuple(keys.slice(1))} > ${tuple(values.slice(1))}`, GENRE_PAGE_SIZE, browse);
      if (raw.length < GENRE_PAGE_SIZE) raw.push(...read(db, genreId, sort,
        sql`${keys[0]!} < ${values[0]!}`, GENRE_PAGE_SIZE - raw.length, browse));
    }
  }
  const rows = raw.map(r => {
    const base = { id: r.id, hasFile: r.path !== "", letter: r.letter };
    if (!browse) return base;
    const summary: SongSummary = {
      id: r.id, title: r.title as string, artist: r.artist as string, durationMs: r.durationMs as number,
      thumbPath: r.thumbPath as string | null, hasFile: base.hasFile, explicit: r.explicit as SongSummary["explicit"],
      albumId: r.albumId as number, artistId: r.artistId as number,
      fixable: canFixSong({ path: base.hasFile ? r.path : null, hasLyrics: Boolean(r.hasLyrics),
        genre: r.genre as string | null, trackNumber: r.trackNumber as number | null,
        year: r.year as number | null, explicit: r.explicit as SongSummary["explicit"] }),
    };
    return { ...base, summary };
  });
  const last = raw.at(-1);
  const next = raw.length < GENRE_PAGE_SIZE || last === undefined ? null : {
    genreId, sort: sortKey(sort), revision, values: terms.map((_, i) => last[`k${i}`] as string | number),
  };
  return { rows, next, stale: false } as GenrePage<B extends true ? GenreBrowseRow : GenreOrderRow>;
};
export const selectGenreOpening = (db: LibraryDatabase, genreId: number, sort: LibrarySongSort): GenreOpening | null => {
  const header = selectGenreHeader(db, genreId);
  if (header === null) return null;
  const { revision, ...genre } = header;
  return { genre, revision, page: selectGenrePage(db, genreId, sort, null, true, revision) };
};
