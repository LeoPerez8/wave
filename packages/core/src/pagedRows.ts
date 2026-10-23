/**
 * A long list read a page at a time (Library › Songs, #310): the list's order
 * is known as keys (Track ids), and only the rows near the screen are read and
 * kept. Rows are filed by key, never by position, so a new order (a scan, a
 * deletion, another sort) can't show a row twice or skip one: each place shows
 * its own key's row, or a placeholder while it loads.
 */

/** How much of the list is read and kept around the rows on screen. */
export interface PagedRowsLimits {
  /** Rows one read asks for. */
  readonly pageSize: number;
  /** Pages read past the rows on screen, each way, so a scroll finds them ready. */
  readonly ahead: number;
  /** Pages kept past the rows on screen, each way; rows further away are dropped. */
  readonly keep: number;
}

/**
 * Pages of 50 rows (a screen and a half of the S24+'s Songs list), one more
 * read each way, and three kept each way: at most 9 pages, 450 rows, held.
 */
export const PAGED_ROWS_LIMITS: PagedRowsLimits = { pageSize: 50, ahead: 1, keep: 3 };

/** What a paged list did, for a perf build's counters. */
export interface PagedRowsStats {
  /** Reads asked for. */
  readonly reads: number;
  /** Rows those reads returned. */
  readonly rowsRead: number;
  /** Rows a read returned after a newer order came in (shown, then read again). */
  readonly staleRows: number;
  /** Rows held now. */
  readonly held: number;
}

export interface PagedRows<K, R> {
  /**
   * The list's keys, in order (each new read of it). Rows already read keep
   * showing in their keys' new places, and those near the screen are read again,
   * except [known]: rows read along with this order (a genre's first page, #601).
   */
  readonly setOrder: (keys: readonly K[], known?: readonly R[]) => void;
  /** Rows [start, end) of the list are on screen. */
  readonly view: (start: number, end: number) => void;
  /** The row at [index], or undefined while it loads. */
  readonly row: (index: number) => R | undefined;
  /** The row of [key], or undefined while it isn't held (not read yet, or far from the screen). */
  readonly rowOf: (key: K) => R | undefined;
  /** Calls [listener] whenever rows arrive; returns how to stop. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly stats: () => PagedRowsStats;
}

/** A key's row, and which order it was read for. */
interface Held<R> {
  /** Undefined when the read no longer found the key (it left the Library). */
  readonly row: R | undefined;
  readonly order: number;
}

/**
 * A list read in pages. [read] reads the rows of [keys] (any order; keys it
 * can't find left out) and calls `settle` with them, or with null when the
 * read failed; [keyOf] tells a row's key.
 */
export const createPagedRows = <K, R>(options: {
  readonly read: (keys: readonly K[], settle: (rows: readonly R[] | null) => void) => void;
  readonly keyOf: (row: R) => K;
  readonly limits?: PagedRowsLimits;
}): PagedRows<K, R> => {
  const { read, keyOf } = options;
  const { pageSize, ahead, keep } = options.limits ?? PAGED_ROWS_LIMITS;
  let keys: readonly K[] = [];
  /** Bumped by each new order: rows read for an older one are read again. */
  let order = 0;
  const held = new Map<K, Held<R>>();
  /** The keys being read, with the order each read was asked for. */
  const reading = new Map<K, number>();
  // Until the list says what it shows, the top of it.
  let view = { start: 0, end: pageSize };
  const listeners = new Set<() => void>();
  const counts = { reads: 0, rowsRead: 0, staleRows: 0 };

  const pageOf = (index: number): number => Math.floor(index / pageSize);
  const lastPage = (): number => pageOf(Math.max(0, keys.length - 1));
  /** The pages from [first] to [last] that the list has, nearest the screen first. */
  const pages = (spread: number): number[] => {
    const first = Math.max(0, pageOf(view.start) - spread);
    const last = Math.min(lastPage(), pageOf(Math.max(view.start, view.end - 1)) + spread);
    const out: number[] = [];
    for (let page = first; page <= last; page++) out.push(page);
    return out;
  };

  const settled =
    (asked: readonly K[], askedOrder: number) =>
    (rows: readonly R[] | null): void => {
      for (const key of asked) if (reading.get(key) === askedOrder) reading.delete(key);
      if (rows !== null) {
        counts.rowsRead += rows.length;
        if (askedOrder !== order) counts.staleRows += rows.length;
        const found = new Map<K, R>();
        for (const row of rows) found.set(keyOf(row), row);
        for (const key of asked) {
          // A newer order's read already answered for it.
          if ((held.get(key)?.order ?? -1) > askedOrder) continue;
          held.set(key, { row: found.get(key), order: askedOrder });
        }
      }
      drop();
      // A failed read isn't asked again from here (it would fail again at once): the list's next move asks it.
      for (const listener of listeners) listener();
    };

  /** Reads the pages near the screen that aren't read for this order nor being read. */
  const load = (): void => {
    if (keys.length === 0) return;
    for (const page of pages(ahead)) {
      const wanted = keys
        .slice(page * pageSize, (page + 1) * pageSize)
        .filter((key) => held.get(key)?.order !== order && reading.get(key) !== order);
      if (wanted.length === 0) continue;
      for (const key of wanted) reading.set(key, order);
      counts.reads += 1;
      read(wanted, settled(wanted, order));
    }
  };

  /** Lets go of the rows of keys no longer near the screen (or no longer in the list). */
  const drop = (): void => {
    const near = new Set<K>();
    for (const page of pages(keep))
      for (const key of keys.slice(page * pageSize, (page + 1) * pageSize)) near.add(key);
    for (const key of held.keys()) if (!near.has(key)) held.delete(key);
  };

  return {
    setOrder: (next, known = []) => {
      keys = next;
      order += 1;
      for (const row of known) held.set(keyOf(row), { row, order });
      drop();
      load();
      if (known.length > 0) for (const listener of listeners) listener();
    },
    view: (start, end) => {
      view = { start, end };
      drop();
      load();
    },
    row: (index) => {
      const key = keys[index];
      return key === undefined ? undefined : held.get(key)?.row;
    },
    rowOf: (key) => held.get(key)?.row,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ ...counts, held: held.size }),
  };
};
