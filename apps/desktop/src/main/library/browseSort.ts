import type { LibraryDatabase } from "@wave/client/db/database";
import {
  librarySongSort,
  libraryTableSortsFor,
  nextHeaderSort,
  readLibraryTableSort,
  songOrderTerms,
  songSpineField,
  writeSongSort,
  type SongOrderField,
  type SongSort,
} from "@wave/core";
import { asc, desc, sql, type SQL } from "drizzle-orm";
import { preference, savePreference } from "../preferences.ts";

const preferenceKey = (kind: string) => `tableSort.${kind}`;

export const readBrowseSort = (db: LibraryDatabase, kind: string): SongSort | undefined => {
  const choices = libraryTableSortsFor(kind);
  return choices.length === 0
    ? undefined
    : readLibraryTableSort(choices, preference(db, preferenceKey(kind)) ?? null);
};

export const toggleBrowseSort = (db: LibraryDatabase, kind: string, key: string): void => {
  const choices = libraryTableSortsFor(kind);
  const current = readLibraryTableSort(choices, preference(db, preferenceKey(kind)) ?? null);
  const next = current && nextHeaderSort(choices, current, key);
  if (next) savePreference(db, preferenceKey(kind), writeSongSort(next));
};

/** Fields projected by the songs query in browse.ts. */
const columns: Record<SongOrderField, SQL> = {
  titleSort: sql`sort`,
  artistSort: sql`artistSort`,
  albumSort: sql`albumSort`,
  albumId: sql`albumId`,
  discNumber: sql`disc`,
  trackNumber: sql`trackNumber`,
  addedAt: sql`addedAt`,
  path: sql`path`,
  id: sql`id`,
};

/** Core's primary and tie orders, applied before paging or starting playback. */
export const songBrowseOrder = (sort: SongSort): SQL => {
  const terms = songOrderTerms(librarySongSort(sort));
  const seen = new Set<SongOrderField>();
  const order = terms
    .filter(({ field }) => !seen.has(field) && seen.add(field))
    .map(({ field, descending, nullAs }) => {
      const column = columns[field];
      const value = nullAs === undefined ? column : sql`coalesce(${column}, ${nullAs})`;
      return descending ? desc(value) : asc(value);
    });
  if (sort.key === "starred")
    order.unshift(sort.descending ? desc(sql`starredAt`) : asc(sql`starredAt`));
  return sql.join(order, sql`, `);
};

export const songBrowseSpine = (sort: SongSort): SQL | undefined => {
  if (sort.key === "starred" || sort.key === "popular") return undefined;
  const field = songSpineField(librarySongSort(sort));
  return field === undefined ? undefined : columns[field];
};
