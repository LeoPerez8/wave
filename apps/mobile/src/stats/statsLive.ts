import { loadRecapStories } from "@wave/client/db/recapStories";
import { artistListeningStats, statsQueries } from "@wave/client/db/statsQueries";
import {
  availableRecaps,
  createRecapAvailability,
  recapId,
  recapWindow,
  type CountedListening,
  type RecapPeriod,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { runSteps } from "@/lib/stepped";
import { LibraryStore, type LibraryStoreError } from "@/library/LibraryStore";

import type { LoadedRecap, Stats } from "./Stats";

/** `period`'s Recap from the store, or null when it has none at `now`. */
const loadRecap = (
  store: LibraryStore["Service"],
  period: RecapPeriod,
  now: number,
): Effect.Effect<LoadedRecap | null, LibraryStoreError> =>
  Effect.gen(function* () {
    const listening = yield* readRecapListening(store, period, Effect.yieldNow);
    const id = recapId(period);
    if (!availableRecaps(listening, now).some((available) => recapId(available) === id)) {
      return null;
    }
    const { lyricsAndGenreLookupsEnabled } = yield* Effect.promise(
      () => import("@/settings/lyricsAndGenre"),
    );
    const plays = yield* store.recapPlays(recapWindow(period), lyricsAndGenreLookupsEnabled());
    return yield* loadRecapStories(store, { period, listening, plays });
  });

/** Stories retain only the requested period, quarter sums unchanged; source reads still yield. */
const readRecapListening = (
  store: LibraryStore["Service"],
  period: RecapPeriod,
  between: Effect.Effect<void>,
): Effect.Effect<readonly CountedListening[], LibraryStoreError> =>
  Effect.gen(function* () {
    const window = recapWindow(period);
    const quarters = new Map<number, number>();
    yield* readListeningPages(store, between, (entry) => {
      if (entry.startedAt >= window.from! && entry.startedAt <= window.to)
        quarters.set(entry.startedAt, (quarters.get(entry.startedAt) ?? 0) + entry.listenedMs);
    });
    function* collect(): Generator<void, CountedListening[]> {
      const rows: CountedListening[] = [];
      for (const [startedAt, listenedMs] of quarters) {
        rows.push({ startedAt, listenedMs });
        yield;
      }
      return rows;
    }
    return yield* runSteps(collect(), between);
  });

/** Sole bounded listening source seam; no calendar policy is passed to SQLite. */
const readListeningPages = (
  store: LibraryStore["Service"],
  between: Effect.Effect<void>,
  add: (entry: CountedListening) => void,
): Effect.Effect<void, LibraryStoreError> =>
  Effect.gen(function* () {
    let after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.countedListeningPage(after);
      for (const entry of page.rows) add(entry);
      if (page.next === null) break;
      after = page.next;
    }
  });

/** Bounded source pages and stepped Core decisions; every source/CPU stage starts on a free turn. */
const readRecapAvailability = (
  store: LibraryStore["Service"],
  now: number,
  between: Effect.Effect<void>,
): Effect.Effect<readonly RecapPeriod[], LibraryStoreError> =>
  Effect.gen(function* () {
    const build = createRecapAvailability();
    yield* readListeningPages(store, between, build.add);
    return yield* runSteps(build.finish(now), between);
  });

/** Stats over the Library's play history (`Stats`'s layer builds it on first use). */
export const make = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const stats: Stats["Service"] = {
    ...statsQueries(
      store,
      Effect.promise(async () => {
        const { lyricsAndGenreLookupsEnabled } = await import("@/settings/lyricsAndGenre");
        return lyricsAndGenreLookupsEnabled();
      }),
    ),
    artist: (artistId, strings) => artistListeningStats(store, artistId, strings),
    recaps: (now, between) => readRecapAvailability(store, now, between),
    recapHistoryVersion: store.listeningHistoryVersion,
    recap: (period) => Effect.suspend(() => loadRecap(store, period, Date.now())),
  };
  return stats;
});
