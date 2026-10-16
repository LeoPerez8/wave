import { createPagedRows, type LibrarySongSort, type PagedRows } from "@wave/core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { registerPerfMeta } from "@/perf/perf";

import { LibraryStore, type SongOrder, type SongSummary } from "./LibraryStore";
import { appRuntime } from "./runtime";
import { libraryQuery, useLibraryQuery, type LibraryQuery } from "./sharedQueries";

/** One shared query per sort: every screen showing Songs in it shares one read. */
const orderQueries = new Map<string, LibraryQuery<SongOrder>>();

const orderQuery = (sort: LibrarySongSort): LibraryQuery<SongOrder> => {
  const key = `songOrder:${sort.key}:${sort.descending ? "desc" : "asc"}`;
  let query = orderQueries.get(key);
  if (query === undefined) {
    query = libraryQuery(
      key,
      // Any change to the tracks may move, add or remove one.
      { tracks: true },
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      LibraryStore.use((store) => store.listSongOrder(sort)),
    );
    orderQueries.set(key, query);
  }
  return query;
};

/**
 * Library › Songs in [sort] as Track ids, with its spine and missing songs;
 * null until first read. Read again (and paused while out of sight) as every
 * shared Library query is.
 */
export const useSongOrder = (sort: LibrarySongSort): SongOrder | null =>
  useLibraryQuery<SongOrder | null>(orderQuery(sort), null);

/** Reads the rows of [ids], outside whatever asked (a scroll, a commit). */
const readSummaries = (
  ids: readonly number[],
  settle: (rows: readonly SongSummary[] | null) => void,
): void => {
  setTimeout(() => {
    appRuntime
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      .runPromise(LibraryStore.use((store) => store.songSummaries(ids)))
      .then(settle, () => settle(null));
  }, 0);
};

/** The Songs list showing now, for a perf build's counters. */
let shownPages: PagedRows<number, SongSummary> | null = null;
registerPerfMeta("songPages", () => ({ ...shownPages?.stats() }));

const keyOf = (row: SongSummary): number => row.id;

/**
 * The rows of [order], read a page at a time around the rows on screen
 * (Core's `createPagedRows`). Tell it what is on screen with `view`; `version`
 * changes whenever rows arrive. A new order (a scan, an edit, another sort)
 * keeps the rows read so far showing while those on screen are read again.
 */
export const usePagedSongs = (
  order: SongOrder | null,
): { readonly pages: PagedRows<number, SongSummary>; readonly version: number } => {
  const [pages] = useState(() => createPagedRows({ read: readSummaries, keyOf }));
  /** How many times rows have arrived: what re-renders the list. */
  const arrived = useRef(0);

  useEffect(() => {
    if (order !== null) pages.setOrder(order.ids);
  }, [pages, order]);

  useEffect(() => {
    shownPages = pages;
    return () => {
      if (shownPages === pages) shownPages = null;
    };
  }, [pages]);

  const subscribe = useCallback(
    (onChange: () => void) =>
      pages.subscribe(() => {
        arrived.current += 1;
        onChange();
      }),
    [pages],
  );
  const version = useSyncExternalStore(subscribe, () => arrived.current);
  return { pages, version };
};
