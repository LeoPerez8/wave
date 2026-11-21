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
 * - Searches use the last index while a source is prepared again. Until
 *   every source has been prepared once, the index holds those that have
 *   (`complete` says when all have), so a search works with what is ready.
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
   * same array as last time changes nothing. With [keyOf] (a row's id), a
   * row whose entry has the same texts as the last prepared one of its key
   * keeps what was prepared: rows read again are prepared only where they
   * changed.
   */
  readonly update: <R>(
    source: S,
    rows: readonly R[],
    entryOf: (row: R) => E,
    keyOf?: (row: R) => string | number,
  ) => void;
  /**
   * Puts [rows] into source [source]'s latest rows in place of the rows with
   * their keys, each where [compare] (the order the source's rows are read
   * in) files it, as `update` with those rows would: a scan batch or a
   * download shows without reading the whole source again, and only the rows
   * patched are prepared. Needs rows given with keys (`update`'s [keyOf]);
   * without them it changes nothing and returns false.
   */
  readonly patch: <R>(source: S, rows: readonly R[], compare: (a: R, b: R) => number) => boolean;
  /** Source [source]'s latest rows (given or patched), or null before the first. */
  readonly rows: (source: S) => readonly unknown[] | null;
  /**
   * Prepares at most [budget] entries of the sources that changed; returns
   * whether there is more to prepare.
   */
  readonly work: (budget: number) => boolean;
  /**
   * The current index over the sources prepared so far, or null before the
   * first is (and, after `unfollowed`, until every source is given again and
   * prepared). The same object until a source changes.
   */
  readonly index: () => SearchIndex<E> | null;
  /**
   * Nothing follows the sources any more, so they may change unseen: no
   * index until each is given again (`update`) and its rows are prepared.
   */
  readonly unfollowed: () => void;
  /** Whether every source has been prepared once: until then the index holds only those that have. */
  readonly complete: () => boolean;
  readonly stats: () => SearchCatalogStats;
}

type Key = string | number;

interface Pending<E> {
  readonly rows: readonly unknown[];
  readonly entryOf: (row: unknown) => E;
  readonly keyOf: ((row: unknown) => Key) | undefined;
  readonly done: Indexed<E>[];
  /** The prepared entries by key, filled as [done] is; null without keys. */
  readonly keyed: Map<Key, Indexed<E>> | null;
  readonly normalize: (text: string) => string;
}

interface Current<E> {
  readonly rows: readonly unknown[];
  readonly entries: readonly Indexed<E>[];
  /** The entries by key, when the rows were given with keys. */
  readonly byKey: ReadonlyMap<Key, Indexed<E>> | null;
}

/** Whether [a] and [b] are searched by the same texts. */
const sameTexts = (a: SearchEntry, b: SearchEntry): boolean => {
  if (a.kind !== b.kind || a.name !== b.name) return false;
  const left = a.also ?? [];
  const right = b.also ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
};

interface Source<E> {
  readonly group: number;
  /** The rows the prepared entries are for, and the entries; null before the first. */
  current: Current<E> | null;
  /** Rows being prepared, or null. */
  pending: Pending<E> | null;
  /** The rows last given (`update`), or null when none were since `unfollowed`. */
  given: readonly unknown[] | null;
  /** How the latest rows were given, for patching them. */
  way: {
    readonly entryOf: (row: unknown) => E;
    readonly keyOf: ((row: unknown) => Key) | undefined;
  } | null;
}

export const createSearchCatalog = <S extends string, E extends SearchEntry>(
  sources: readonly S[],
): SearchCatalog<S, E> => {
  const bySource = new Map<S, Source<E>>(
    sources.map((name, group) => [
      name,
      { group, current: null, pending: null, given: null, way: null },
    ]),
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

  /** Puts the index together from every source prepared so far. */
  const assemble = (): void => {
    const parts: (readonly Indexed<E>[])[] = [];
    for (const source of bySource.values())
      if (source.current !== null) parts.push(source.current.entries);
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

  const update = <R>(
    name: S,
    rows: readonly R[],
    entryOf: (row: R) => E,
    keyOf?: (row: R) => Key,
  ): void => {
    const source = sourceOf(name);
    source.given = rows;
    source.way = {
      entryOf: entryOf as (row: unknown) => E,
      keyOf: keyOf as ((row: unknown) => Key) | undefined,
    };
    if (source.pending?.rows === rows) return;
    // The prepared rows again (or back to them): nothing to prepare.
    if (source.current?.rows === rows) {
      source.pending = null;
      return;
    }
    source.pending = {
      rows,
      entryOf: entryOf as (row: unknown) => E,
      keyOf: keyOf as ((row: unknown) => Key) | undefined,
      done: [],
      keyed: keyOf === undefined ? null : new Map(),
      normalize: memoize(normalizeSearchText),
    };
  };

  const latestRows = (source: Source<E>): readonly unknown[] | null =>
    source.pending?.rows ?? source.given ?? source.current?.rows ?? null;

  return {
    update,
    patch: (name, rows, compare) => {
      const source = sourceOf(name);
      const base = latestRows(source);
      const keyOf = source.way?.keyOf;
      if (base === null || keyOf === undefined || source.way === null) return false;
      const order = compare as (a: unknown, b: unknown) => number;
      const replaced = new Set(rows.map(keyOf));
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      const added = [...rows].sort(order);
      const merged: unknown[] = [];
      let next = 0;
      for (const row of base) {
        if (replaced.has(keyOf(row))) continue;
        while (next < added.length && order(added[next], row) < 0) merged.push(added[next++]);
        merged.push(row);
      }
      while (next < added.length) merged.push(added[next++]);
      update(name, merged, source.way.entryOf, keyOf);
      return true;
    },
    rows: (name) => latestRows(sourceOf(name)),
    work: (budget) => {
      let left = Math.max(1, budget);
      let changed = false;
      for (const source of bySource.values()) {
        const pending = source.pending;
        if (pending === null) continue;
        const { rows, done, entryOf, keyOf, keyed, normalize } = pending;
        const before = keyOf === undefined ? null : (source.current?.byKey ?? null);
        const start = done.length;
        const end = Math.min(rows.length, start + left);
        for (let order = start; order < end; order++) {
          const row = rows[order];
          const entry = entryOf(row);
          const key = keyed === null ? undefined : keyOf!(row);
          const last = key === undefined ? undefined : before?.get(key);
          let item: Indexed<E>;
          if (last !== undefined && sameTexts(last.entry, entry)) {
            item = { ...last, entry, group: source.group, order };
          } else {
            item = prepareSearchEntry(entry, source.group, order, normalize);
            prepared++;
          }
          done.push(item);
          if (key !== undefined) keyed!.set(key, item);
        }
        left -= end - start;
        if (done.length === rows.length) {
          source.current = { rows, entries: done, byKey: keyed };
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
    complete: () => {
      for (const source of bySource.values()) if (source.current === null) return false;
      return true;
    },
    stats: () => ({ entries, prepared, indexes }),
  };
};
