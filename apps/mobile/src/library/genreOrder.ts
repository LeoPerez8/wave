/**
 * A genre's whole order (#601), what its spine, Play, Shuffle, taps and
 * selections act on: read after the screen opens on its first page, one
 * slice of ids a turn, never on the opening's path. Kept free of Expo and
 * React so it runs under plain Node tests.
 */
import { spineEntries, type LibrarySongSort } from "@wave/core";
import * as Effect from "effect/Effect";

import type { GenreOrderSlice } from "./db/genrePages.ts";
import type { LibraryStore, LibraryStoreError, SongOrder } from "./LibraryStore.ts";

type Slices = Pick<LibraryStore["Service"], "genreOrderSlice">;

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
}

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
  let reading: { readonly answer: Promise<SongOrder>; readonly controller: AbortController } | null =
    null;
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
      if (order !== null) return Promise.resolve(order);
      if (disposed) return Promise.resolve(null);
      if (reading !== null && waiting) reading.controller.abort();
      const answer = reading !== null && !waiting ? reading.answer : start(false);
      return answer.catch(() => null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      reading?.controller.abort();
      reading = null;
    },
  };
};
