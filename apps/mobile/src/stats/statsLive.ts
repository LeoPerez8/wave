import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import { artistListeningStats, rankSongs, statsQueries } from "@wave/client/db/statsQueries";
import {
  availableRecaps,
  createRecapAvailability,
  recap,
  recapId,
  recapSlides,
  recapWindow,
  type EntityPlayTotals,
  type CountedListening,
  type RecapPeriod,
  type RecapSlide,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { runSteps } from "@/lib/stepped";
import { LibraryStore, type LibraryStoreError } from "@/library/LibraryStore";

import type { LoadedRecap, LoadedRecapSlide, Ranked, Stats, StatsSong } from "./Stats";

/** How many discovered artists a Recap's slide names. */
const DISCOVERED_SHOWN = 5;

/** The rows a Recap's slides show, by the ids Core ranked them by. */
interface RecapRows {
  readonly artists: ReadonlyMap<number | string, PlayedArtist>;
  readonly albums: ReadonlyMap<number | string, PlayedAlbum>;
}

/** [ranking]'s entities with their rows, in ranking order; one without a row is skipped. */
const withItems = <A>(
  ranking: readonly EntityPlayTotals[],
  rows: ReadonlyMap<number | string, A>,
): Ranked<A>[] =>
  ranking.flatMap((entry) => {
    const item = rows.get(entry.id);
    return item === undefined ? [] : [{ item, countedPlays: entry.countedPlays }];
  });

/** A Recap's song ranking as Stats ranks songs: a Library song by its id, a streamed one by its video id. */
const recapSongs = (
  store: LibraryStore["Service"],
  ranking: readonly EntityPlayTotals[],
): Effect.Effect<readonly Ranked<StatsSong>[], LibraryStoreError> =>
  rankSongs(
    store,
    ranking.map(({ id, ...totals }) => ({
      ...totals,
      song: typeof id === "number" ? { kind: "library", id } : { kind: "yt", videoId: id },
    })),
  );

/** Loads a slide's rows; a slide whose songs, artists or album all left the library is dropped. */
const loadSlide = (
  store: LibraryStore["Service"],
  rows: RecapRows,
  slide: RecapSlide,
): Effect.Effect<readonly LoadedRecapSlide[], LibraryStoreError> => {
  switch (slide.kind) {
    case "minutes":
      return Effect.succeed([slide]);
    case "topSongs":
      return Effect.map(recapSongs(store, slide.songs), (songs) =>
        songs.length === 0 ? [] : [{ kind: "topSongs", songs }],
      );
    case "topArtists": {
      const artists = withItems(slide.artists, rows.artists);
      return Effect.succeed(artists.length === 0 ? [] : [{ kind: "topArtists", artists }]);
    }
    case "topAlbum": {
      const [album] = withItems([slide.album], rows.albums);
      return Effect.succeed(album === undefined ? [] : [{ kind: "topAlbum", album }]);
    }
    case "discovered": {
      const artists = withItems(slide.artists.slice(0, DISCOVERED_SHOWN), rows.artists);
      return Effect.succeed(
        artists.length === 0 ? [] : [{ kind: "discovered", count: slide.artists.length, artists }],
      );
    }
    case "summary":
      return Effect.map(recapSongs(store, slide.songs), (songs) => [
        {
          kind: "summary",
          minutes: slide.minutes,
          songs,
          artists: withItems(slide.artists, rows.artists),
          genre: slide.genre,
        },
      ]);
    case "topGenres":
    case "habits":
      return Effect.succeed([slide]);
  }
};

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
    const computed = recap({ period, listening, ...plays });
    const rows: RecapRows = {
      artists: new Map(plays.artists.map((entry) => [entry.id, entry.item])),
      albums: new Map(plays.albums.map((entry) => [entry.id, entry.item])),
    };
    const slides = yield* Effect.forEach(recapSlides(computed), (slide) =>
      loadSlide(store, rows, slide),
    );
    return { period, title: computed.title, slides: slides.flat() };
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
