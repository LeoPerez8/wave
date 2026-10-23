/**
 * A genre's whole order (#601), what its spine, Play, Shuffle, taps and
 * selections act on: read after the screen opens on its first page, one
 * slice of ids a turn, never on the opening's path. Kept free of Expo and
 * React so it runs under plain Node tests.
 */
import { PAGED_ROWS_LIMITS, spineEntries, type LibrarySongSort } from "@wave/core";
import * as Effect from "effect/Effect";

import type { GenreOrderSlice } from "./db/genrePages.ts";
import type { LibraryStore, LibraryStoreError, SongOrder, SongRow } from "./LibraryStore.ts";

type Slices = Pick<LibraryStore["Service"], "genreOrderSlice">;

/** Full rows for selection actions, a page per free turn, in the checked order. */
export const readGenreSongs = (
  store: Pick<LibraryStore["Service"], "songsWithIds">,
  ids: readonly number[],
  turn: Effect.Effect<void>,
): Effect.Effect<readonly SongRow[], LibraryStoreError> =>
  Effect.gen(function* () {
    const rows: SongRow[] = [];
    for (let start = 0; start < ids.length; start += PAGED_ROWS_LIMITS.pageSize) {
      yield* turn;
      rows.push(
        ...(yield* store.songsWithIds(ids.slice(start, start + PAGED_ROWS_LIMITS.pageSize))),
      );
    }
    return rows;
  });

/**
 * [genreId]'s whole order in [sort], going on from [first] (the opening's
 * page) a slice per [turn]. When the genre's order changes on the way (a
 * scan, an edit), it starts again from the top: the ids are never two orders
 * stitched together.
 */
export const readGenreOrder = (
  store: Slices,
  genreId: number,
  sort: LibrarySongSort,
  first: GenreOrderSlice,
  turn: Effect.Effect<void>,
): Effect.Effect<SongOrder, LibraryStoreError> =>
  Effect.gen(function* () {
    let slice = first;
    const ids: number[] = [];
    const missing: number[] = [];
    const letters: string[] = [];
    for (;;) {
      ids.push(...slice.ids);
      missing.push(...slice.missing);
      letters.push(...slice.letters);
      if (slice.next === null) return { ids, missing, spine: spineEntries(letters) };
      yield* turn;
      const next = yield* store.genreOrderSlice(genreId, sort, slice.next);
      if (next !== null) {
        slice = next;
        continue;
      }
      // Changed since: from the top, in its new order.
      ids.length = 0;
      missing.length = 0;
      letters.length = 0;
      slice = (yield* store.genreOrderSlice(genreId, sort, null))!;
    }
  });

/** One genre opening's whole order, read once (`createGenreOrderLoad`). */
export interface GenreOrderLoad {
  /** The whole order, once read; null until then. */
  readonly current: () => SongOrder | null;
  /** Reads it once the screen has settled, unless something asked for it first. */
  readonly inBackground: () => void;
  /** The whole order for an action: read now if it isn't (sharing a read under way); null once let go. */
  readonly whole: () => Promise<SongOrder | null>;
  /** Calls [listener] when the whole order arrives; returns how to stop. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Stops a read under way; what waits for it gets null. */
  readonly dispose: () => void;
  /** Whether `dispose` let it go (a null from `whole` then isn't a failed read). */
  readonly disposed: () => boolean;
}

/**
 * Where a genre screen's Play, Shuffle and taps find the whole order: the
 * screen's load when they're pressed, or, when that load is let go before it
 * answers (the genre's order or its sort changed), the load after it.
 */
export interface GenreOrderActions {
  /** The screen's load now; null while its opening is read. */
  readonly show: (load: GenreOrderLoad | null) => void;
  /** Whether the screen is open; closing it answers what waits with null. */
  readonly open: (open: boolean) => void;
  /** The whole order to play; null once the screen closed or the read failed. */
  readonly whole: () => Promise<SongOrder | null>;
}

export const createGenreOrderActions = (): GenreOrderActions => {
  let load: GenreOrderLoad | null = null;
  let open = true;
  const waiters = new Set<() => void>();
  const changed = () => {
    for (const waiter of [...waiters]) waiter();
    waiters.clear();
  };
  const nextChange = () => new Promise<void>((resolve) => waiters.add(resolve));
  return {
    show: (next) => {
      load = next;
      changed();
    },
    open: (next) => {
      open = next;
      changed();
    },
    whole: async () => {
      for (;;) {
        if (!open) return null;
        const asked = load;
        if (asked === null) {
          await nextChange();
          continue;
        }
        const order = await asked.whole();
        if (order !== null) return open ? order : null;
        // A failed read ends the press, as it would on any genre.
        if (!asked.disposed()) return null;
        // Let go for a newer order: ask the load that replaces it, once it shows.
        while (open && load === asked) await nextChange();
      }
    },
  };
};

/**
 * Reads [read] (`readGenreOrder`'s slices) once for one opening: in the
 * background after [settled], or at once when an action asks for it before
 * then. [run] runs an Effect until [signal] aborts it.
 */
export const createGenreOrderLoad = <R>(options: {
  readonly read: Effect.Effect<SongOrder, LibraryStoreError, R>;
  readonly settled: Effect.Effect<void>;
  readonly run: (
    effect: Effect.Effect<SongOrder, LibraryStoreError, R>,
    signal: AbortSignal,
  ) => Promise<SongOrder>;
}): GenreOrderLoad => {
  let order: SongOrder | null = null;
  let reading: {
    readonly answer: Promise<SongOrder>;
    readonly controller: AbortController;
  } | null = null;
  /** Whether the read under way still waits for the screen to settle. */
  let waiting = false;
  let disposed = false;
  const listeners = new Set<() => void>();

  const start = (afterSettled: boolean): Promise<SongOrder> => {
    const controller = new AbortController();
    waiting = afterSettled;
    const settledFirst = afterSettled
      ? options.settled.pipe(Effect.andThen(Effect.sync(() => (waiting = false))))
      : Effect.void;
    const answer = options.run(Effect.andThen(settledFirst, options.read), controller.signal);
    const entry = { answer, controller };
    reading = entry;
    answer.then(
      (whole) => {
        if (reading !== entry) return;
        reading = null;
        order = whole;
        for (const listener of listeners) listener();
      },
      () => {
        if (reading === entry) reading = null;
      },
    );
    return answer;
  };

  return {
    current: () => order,
    inBackground: () => {
      if (!disposed && order === null && reading === null) void start(true).catch(() => {});
    },
    whole: () => {
      if (disposed) return Promise.resolve(null);
      if (order !== null) return Promise.resolve(order);
      if (reading !== null && waiting) reading.controller.abort();
      const answer = reading !== null && !waiting ? reading.answer : start(false);
      return answer.then(
        (value) => (disposed ? null : value),
        () => null,
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      order = null;
      reading?.controller.abort();
      reading = null;
    },
    disposed: () => disposed,
  };
};
