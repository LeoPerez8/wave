/**
 * The Library's lists in memory (#1352): the rows Search's index holds for
 * the session and keeps current with every change (`search/searchIndex.ts`,
 * #1354), shared here so a Library page drawn from them (`libraryMemory.ts`)
 * costs no second copy. Null until the songs, albums, artists and genres are
 * each read once.
 */
import type { AlbumRow, ArtistRow, GenreRow, SongRow } from "@wave/client";

export interface LibraryRows {
  readonly songs: readonly SongRow[];
  readonly albums: readonly AlbumRow[];
  readonly artists: readonly ArtistRow[];
  readonly genres: readonly GenreRow[];
}

let rows: LibraryRows | null = null;
const listeners = new Set<() => void>();

/** The index's rows now; telling followers only when one of the lists changed. */
export const publishLibraryRows = (next: LibraryRows): void => {
  if (
    rows !== null &&
    rows.songs === next.songs &&
    rows.albums === next.albums &&
    rows.artists === next.artists &&
    rows.genres === next.genres
  )
    return;
  rows = next;
  for (const listener of listeners) listener();
};

/** The Library's lists in memory, or null until each is read. */
export const libraryRows = (): LibraryRows | null => rows;

/** Follows `libraryRows`; returns how to stop. */
export const subscribeLibraryRows = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
