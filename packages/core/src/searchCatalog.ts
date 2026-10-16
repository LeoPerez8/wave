/**
 * Search's catalog: one search index over several sources (artists, albums,
 * songs, playlists, genres), kept up to date source by source.
 *
 * - Each source is prepared on its own. Rows given again unchanged (the same
 *   array) keep what was prepared; a changed source is prepared again alone,
 *   and the index is put together from every source's prepared entries.
 * - Preparing goes in steps of a bounded number of entries, so the app can
 *   spread it over idle moments: a keystroke or a frame is never kept waiting
 *   for the whole Library.
 * - Searches use the last complete index while a source is prepared again,
 *   and there is no index until every source has been prepared once.
 * - Once nothing follows the sources (`unfollowed`: the screen searching
 *   them let go), they may change unseen: there is no index until every
 *   source is given again and prepared, so a search never finds what the
 *   Library has since lost. Rows given again unchanged need no preparing.
 *
 * The index finds what `createSearchIndex` over every source's entries, in
 * source order, finds.
 */

import {
  type Indexed,
  memoize,
  normalizeSearchText,
  prepareSearchEntry,
  type SearchEntry,
  type SearchIndex,
  searchIndexOver,
} from "./search.ts";

export interface SearchCatalogStats {
  /** Entries in the current index. */
  readonly entries: number;
  /** Entries prepared so far (reused sources prepare none). */
  readonly prepared: number;
  /** Indexes put together so far. */
  readonly indexes: number;
}

export interface SearchCatalog<S extends string, E extends SearchEntry> {
  /**
   * Source [source]'s rows are now [rows], found as [entryOf] makes them. The
   * same array as last time changes nothing.
   */
  readonly update: <R>(source: S, rows: readonly R[], entryOf: (row: R) => E) => void;
  /**
   * Prepares at most [budget] entries of the sources that changed; returns
   * whether there is more to prepare.
   */
  readonly work: (budget: number) => boolean;
  /**
   * The current index, or null until every source has been prepared once
   * (and, after `unfollowed`, until every source is given again and
   * prepared). The same object until a source changes.
   */
  readonly index: () => SearchIndex<E> | null;
  /**
   * Nothing follows the sources any more, so they may change unseen: no
   * index until each is given again (`update`) and its rows are prepared.
   */
  readonly unfollowed: () => void;
  readonly stats: () => SearchCatalogStats;
}

interface Pending<E> {
  readonly rows: readonly unknown[];
  readonly entryOf: (row: unknown) => E;
  readonly done: Indexed<E>[];
  readonly normalize: (text: string) => string;
}

interface Source<E> {
  readonly group: number;
  /** The rows the prepared entries are for, and the entries; null before the first. */
  current: { readonly rows: readonly unknown[]; readonly entries: readonly Indexed<E>[] } | null;
  /** Rows being prepared, or null. */
  pending: Pending<E> | null;
  /** The rows last given (`update`), or null when none were since `unfollowed`. */
  given: readonly unknown[] | null;
}

export const createSearchCatalog = <S extends string, E extends SearchEntry>(
  sources: readonly S[],
): SearchCatalog<S, E> => {
  const bySource = new Map<S, Source<E>>(
    sources.map((name, group) => [name, { group, current: null, pending: null, given: null }]),
  );
  let index: SearchIndex<E> | null = null;
  let entries = 0;
  let prepared = 0;
  let indexes = 0;
  /** Since `unfollowed`, until every source given again is prepared. */
  let waiting = false;

  const sourceOf = (name: S): Source<E> => {
    const source = bySource.get(name);
    if (source === undefined) throw new Error(`Unknown search source ${name}`);
    return source;
  };

  /** Puts the index together once every source is prepared. */
  const assemble = (): void => {
    const parts: (readonly Indexed<E>[])[] = [];
    for (const source of bySource.values()) {
      if (source.current === null) return;
      parts.push(source.current.entries);
    }
    const all = parts.flat();
    index = searchIndexOver(all);
    entries = all.length;
    indexes++;
  };

  /** Whether every source's prepared rows are the ones given since `unfollowed`. */
  const caughtUp = (): boolean => {
    for (const source of bySource.values())
      if (source.given === null || source.current?.rows !== source.given) return false;
    return true;
  };

  return {
    update: (name, rows, entryOf) => {
      const source = sourceOf(name);
      source.given = rows;
      if (source.pending?.rows === rows) return;
      // The prepared rows again (or back to them): nothing to prepare.
      if (source.current?.rows === rows) {
        source.pending = null;
        return;
      }
      source.pending = {
        rows,
        entryOf: entryOf as (row: unknown) => E,
        done: [],
        normalize: memoize(normalizeSearchText),
      };
    },
    work: (budget) => {
      let left = Math.max(1, budget);
      let changed = false;
      for (const source of bySource.values()) {
        const pending = source.pending;
        if (pending === null) continue;
        const { rows, done, entryOf, normalize } = pending;
        const start = done.length;
        const end = Math.min(rows.length, start + left);
        for (let order = start; order < end; order++)
          done.push(prepareSearchEntry(entryOf(rows[order]), source.group, order, normalize));
        left -= end - start;
        prepared += end - start;
        if (done.length === rows.length) {
          source.current = { rows, entries: done };
          source.pending = null;
          changed = true;
        }
        if (left <= 0) break;
      }
      if (changed) assemble();
      for (const source of bySource.values()) if (source.pending !== null) return true;
      return false;
    },
    index: () => {
      if (waiting && caughtUp()) waiting = false;
      return waiting ? null : index;
    },
    unfollowed: () => {
      waiting = true;
      for (const source of bySource.values()) source.given = null;
    },
    stats: () => ({ entries, prepared, indexes }),
  };
};
