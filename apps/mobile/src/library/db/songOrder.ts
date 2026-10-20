/**
 * The Songs list in pages (#310): the whole list's order as Track ids, read
 * without the rows' details, then what each row shows only for the ids on
 * screen, and full song rows only for what an action needs. Kept free of
 * Expo so the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import {
  canFixSong,
  songOrderTerms,
  songSpineField,
  spineEntries,
  type ExplicitFlag,
  type IndexEntry,
  type LibrarySongSort,
  type PlaylistFindText,
  type SongOrderField,
} from "@wave/core";
import { asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { trackGenre, trackQuery } from "./tracks.ts";

/** The Songs list in one sort: every Track's place, its A–Z spine and its missing songs. */
export interface SongOrder {
  /** Every Track id, in the sort's order. */
  readonly ids: readonly number[];
  /** The spine's letters, each with its first row (Core's `spineEntries`); none for date sorts. */
  readonly spine: readonly IndexEntry[];
  /** The ids of the missing songs (no file on this phone): taps download them, plays skip them. */
  readonly missing: readonly number[];
}

/** What one row of the Songs list shows. */
export interface SongSummary {
  readonly id: number;
  readonly title: string;
  /** The credit as written ("Ariana Grande, Doja Cat"). */
  readonly artist: string;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  /** False for a missing song, which the row shows dimmed. */
  readonly hasFile: boolean;
  /** Whether it's explicit, as its file's advisory tag says: the row shows the E badge for it. */
  readonly explicit: ExplicitFlag;
  /** Its album and primary artist, for what its row's swipes offer (Go to Album, Go to Artist). */
  readonly albumId: number;
  readonly artistId: number;
  /** Whether Fix Song can do something for it (Core's `canFixSong`): what its swipe offers. */
  readonly fixable: boolean;
}

/** Where each field Core's order terms name lives. */
const ORDER_COLUMNS: Record<SongOrderField, SQLiteColumn> = {
  titleSort: schema.tracks.titleSort,
  artistSort: schema.artists.sort,
  albumSort: schema.albums.titleSort,
  albumId: schema.tracks.albumId,
  discNumber: schema.tracks.discNumber,
  trackNumber: schema.tracks.trackNumber,
  addedAt: schema.tracks.addedAt,
  path: schema.tracks.path,
  id: schema.tracks.id,
};

/** A null as the term reads it: numbers inline (an integer, as the column holds), text bound. */
const orNull = (column: SQLiteColumn, nullAs: number | string): SQL =>
  typeof nullAs === "number"
    ? sql`coalesce(${column}, ${sql.raw(String(Math.trunc(nullAs)))})`
    : sql`coalesce(${column}, ${nullAs})`;

/** [sort]'s `ORDER BY` (Core's `songOrderTerms`). */
const orderBy = (sort: LibrarySongSort): SQL[] =>
  songOrderTerms(sort).map(({ field, descending, nullAs }) => {
    const column = ORDER_COLUMNS[field];
    const value = nullAs === undefined ? column : orNull(column, nullAs);
    return descending ? desc(value) : asc(value);
  });

/**
 * The whole Songs list in [sort]'s order (the order `sortSongs` gives, ending
 * on the id), each row reduced to its id, whether it has a file and its spine
 * letter. Read as one string ("12:a,-7:b,…": a missing song's id negated) so
 * that 10,000 songs cross into JavaScript as one value, not 10,000 row objects.
 * `group_concat(… ORDER BY …)` needs SQLite 3.44 (expo-sqlite bundles 3.53).
 */
export const selectSongOrder = (db: LibraryDatabase, sort: LibrarySongSort): SongOrder => {
  const { tracks, artists, albums } = schema;
  const spineField = songSpineField(sort);
  const signedId = sql`CASE WHEN ${tracks.path} IS NULL THEN -${tracks.id} ELSE ${tracks.id} END`;
  // The spine reads only a key's first character (Core's `indexLetter`).
  const row =
    spineField === undefined
      ? signedId
      : sql`${signedId} || ':' || substr(${ORDER_COLUMNS[spineField]}, 1, 1)`;
  const { rows } = db.get<{ rows: string | null }>(
    sql`SELECT group_concat(${row}, ',' ORDER BY ${sql.join(orderBy(sort), sql`, `)}) AS rows
      FROM ${tracks}
      JOIN ${artists} ON ${tracks.artistId} = ${artists.id}
      JOIN ${albums} ON ${tracks.albumId} = ${albums.id}`,
  );
  const parts = rows === null ? [] : rows.split(",");
  const ids: number[] = Array.from({ length: parts.length });
  const letters: string[] = spineField === undefined ? [] : Array.from({ length: parts.length });
  const missing: number[] = [];
  parts.forEach((part, index) => {
    const colon = spineField === undefined ? part.length : part.indexOf(":");
    const id = Number(part.slice(0, colon));
    ids[index] = Math.abs(id);
    if (id < 0) missing.push(-id);
    if (spineField !== undefined) letters[index] = part.slice(colon + 1);
  });
  return { ids, spine: spineEntries(letters), missing };
};

/** Each of [ids] that is in the Library, keyed by id, as [read] reads a statement's worth. */
const byIds = <R extends { readonly id: number }>(
  ids: readonly number[],
  read: (some: number[]) => readonly R[],
): R[] => {
  const found = new Map<number, R>();
  for (const some of chunks(ids)) for (const row of read(some)) found.set(row.id, row);
  return ids.flatMap((id) => {
    const row = found.get(id);
    return row === undefined ? [] : [row];
  });
};

/** What the rows of [ids] show, in that order; ids no longer in the Library are left out. */
export const selectSongSummaries = (
  db: LibraryDatabase,
  ids: readonly number[],
): readonly SongSummary[] => {
  const { tracks, artwork } = schema;
  return byIds(ids, (some) =>
    db
      .select({
        id: tracks.id,
        title: tracks.title,
        artist: tracks.artistCredit,
        durationMs: tracks.durationMs,
        thumbPath: artwork.thumbPath,
        path: tracks.path,
        explicit: tracks.explicit,
        albumId: tracks.albumId,
        artistId: tracks.artistId,
        hasLyrics: tracks.hasLyrics,
        genre: trackGenre,
        trackNumber: tracks.trackNumber,
        year: tracks.year,
      })
      .from(tracks)
      .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
      .where(inArray(tracks.id, some))
      .all()
      .map(({ path, hasLyrics, genre, trackNumber, year, ...row }): SongSummary => ({
        ...row,
        hasFile: path !== null,
        fixable: canFixSong({ path, hasLyrics, genre, trackNumber, year, explicit: row.explicit }),
      })),
  );
};

/**
 * The full song rows of [ids], missing songs included, in that order (what
 * a menu, a selection or a play acts on); ids no longer in the Library are left out.
 */
export const selectSongsWithIds = (db: LibraryDatabase, ids: readonly number[]) =>
  byIds(ids, (some) => trackQuery(db).where(inArray(schema.tracks.id, some)).all());

/**
 * What finds each song of the Library, missing songs included, by Track id:
 * its title, artist credit and album (Find in Songs, #530). Read only once a
 * query is typed, so opening Songs still reads no row's details.
 */
export const selectSongFindTexts = (db: LibraryDatabase): ReadonlyMap<number, PlaylistFindText> => {
  const { tracks, albums } = schema;
  const rows = db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artistCredit,
      album: albums.title,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .all();
  return new Map(rows.map(({ id, title, artist, album }) => [id, { title, artist, album }]));
};
