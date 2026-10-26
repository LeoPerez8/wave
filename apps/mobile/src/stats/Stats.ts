import type { PlayedAlbum, PlayedArtist } from "@/library/db/playedEntities";
import {
  ARTIST_MOST_PLAYED,
  artistStats,
  availableRecaps,
  createRecapAvailability,
  rankSongPlays,
  recap,
  recapId,
  recapSlides,
  recapWindow,
  statsWindow,
  type ArtistStats as ArtistStatsLines,
  type EntityPlayTotals,
  type GenreFamily,
  type MixedSong,
  type CountedListening,
  type SongPlayTotals,
  type RecapPeriod,
  type RecapSlide,
  type StatsPeriod,
  type YtAlbumSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runSteps } from "@/lib/stepped";
import type { RecapHistoryVersion } from "./recapAvailability";

import { LibraryStore, type LibraryStoreError, type SongRow } from "@/library/LibraryStore";

/** A ranked entity with its counted plays in the period. */
export interface Ranked<A> {
  readonly item: A;
  readonly countedPlays: number;
}

/** A song in Stats' song ranking: a Library song, or a streamed one the Library hasn't. */
export type StatsSong = MixedSong<YtAlbumSong, SongRow>;

/** An artist page's stats block, its most played songs loaded. */
export type ArtistStats =
  | Extract<ArtistStatsLines, { played: false }>
  | (Omit<Extract<ArtistStatsLines, { played: true }>, "mostPlayed"> & {
      readonly mostPlayed: readonly Ranked<StatsSong>[];
    });

/** A Recap slide with the rows it shows loaded. */
export type LoadedRecapSlide =
  | Exclude<RecapSlide, { kind: "topSongs" | "topArtists" | "topAlbum" | "discovered" | "summary" }>
  | { readonly kind: "topSongs"; readonly songs: readonly Ranked<StatsSong>[] }
  | { readonly kind: "topArtists"; readonly artists: readonly Ranked<PlayedArtist>[] }
  | { readonly kind: "topAlbum"; readonly album: Ranked<PlayedAlbum> }
  | {
      readonly kind: "discovered";
      /** How many artists the period discovered. */
      readonly count: number;
      /** The most played of them, the top one first. */
      readonly artists: readonly Ranked<PlayedArtist>[];
    }
  | {
      /** The summary card: the top songs (Library and streamed) and artists. */
      readonly kind: "summary";
      readonly minutes: number;
      readonly songs: readonly Ranked<StatsSong>[];
      readonly artists: readonly Ranked<PlayedArtist>[];
      readonly genre: GenreFamily | null;
    };

/** How many discovered artists a Recap's slide names. */
const DISCOVERED_SHOWN = 5;

/** A Recap as its stories show it: Core's slides, their songs loaded. */
export interface LoadedRecap {
  readonly period: RecapPeriod;
  readonly title: string;
  readonly slides: readonly LoadedRecapSlide[];
}

export class Stats extends Context.Service<
  Stats,
  {
    /**
     * The `limit` songs played most in `period` (rolling, ending now), the top
     * one first, streamed songs included.
     */
    readonly topSongs: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<StatsSong>[], LibraryStoreError>;
    /** The `limit` albums played most in `period` (title + album artist, as in the Library). */
    readonly topAlbums: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<PlayedAlbum>[], LibraryStoreError>;
    /** The `limit` artists played most in `period`, credited by track artist. */
    readonly topArtists: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<PlayedArtist>[], LibraryStoreError>;
    /**
     * The artist page's stats block over all time, over the songs whose credit
     * names the artist (a collaboration counts for each of its artists).
     */
    readonly artist: (artistId: number) => Effect.Effect<ArtistStats, LibraryStoreError>;
    /** Every period with a Recap now, newest first (Core's `availableRecaps`). */
    readonly recaps: (
      now: number,
      between: Effect.Effect<void>,
    ) => Effect.Effect<readonly RecapPeriod[], LibraryStoreError>;
    readonly recapHistoryVersion: RecapHistoryVersion;
    /** `period`'s Recap, its slides' rows loaded; null when the period has no Recap now. */
    readonly recap: (period: RecapPeriod) => Effect.Effect<LoadedRecap | null, LibraryStoreError>;
  }
>()("@wave/mobile/stats/Stats") {}

/**
 * Loads the rows of a song ranking, in ranking order: the Library's rows and
 * the streamed songs' as their latest plays had them. A song that left since
 * the totals were read is skipped.
 */
const rankSongs = (
  store: LibraryStore["Service"],
  ranking: readonly SongPlayTotals[],
): Effect.Effect<readonly Ranked<StatsSong>[], LibraryStoreError> => {
  const ids = ranking.flatMap(({ song }) => (song.kind === "library" ? [song.id] : []));
  const videoIds = ranking.flatMap(({ song }) => (song.kind === "yt" ? [song.videoId] : []));
  return Effect.map(
    Effect.all([
      ids.length === 0 ? Effect.succeed([]) : store.songsByIds(ids),
      videoIds.length === 0
        ? Effect.succeed(new Map<string, YtAlbumSong>())
        : store.streamedSongsByIds(videoIds),
    ]),
    ([rows, streamed]) => {
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ranking.flatMap(({ song, countedPlays }): Ranked<StatsSong>[] => {
        if (song.kind === "library") {
          const track = byId.get(song.id);
          return track === undefined ? [] : [{ item: { source: "library", track }, countedPlays }];
        }
        const streamedSong = streamed.get(song.videoId);
        return streamedSong === undefined
          ? []
          : [{ item: { source: "stream", song: streamedSong }, countedPlays }];
      });
    },
  );
};

/** The albums and the artists played most in a period, ranked from one read. */
export interface TopAlbumsAndArtists {
  readonly albums: readonly Ranked<PlayedAlbum>[];
  readonly artists: readonly Ranked<PlayedArtist>[];
}

/**
 * The top [albumLimit] albums and [artistLimit] artists of `period`, as
 * Stats' `topAlbums` and `topArtists` rank them, from one read of the
 * credited totals: Home's Most played albums and artists, which show together.
 */
export const topAlbumsAndArtists = (
  store: LibraryStore["Service"],
  period: StatsPeriod,
  albumLimit: number,
  artistLimit: number,
): Effect.Effect<TopAlbumsAndArtists, LibraryStoreError> =>
  Effect.map(
    Effect.suspend(() => store.playedEntityTotals(statsWindow(period, Date.now()))),
    (totals) => ({
      albums: totals.albums.slice(0, albumLimit),
      artists: totals.artists.slice(0, artistLimit),
    }),
  );

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
    const plays = yield* store.recapPlays(recapWindow(period));
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

export const layer = Layer.effect(
  Stats,
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return {
      topSongs: (period, limit) =>
        Effect.flatMap(store.songPlayTotals(statsWindow(period, Date.now())), (totals) =>
          rankSongs(store, rankSongPlays(totals, limit)),
        ),
      topAlbums: (period, limit) =>
        Effect.map(store.playedEntityTotals(statsWindow(period, Date.now())), (totals) =>
          totals.albums.slice(0, limit),
        ),
      topArtists: (period, limit) =>
        Effect.map(store.playedEntityTotals(statsWindow(period, Date.now())), (totals) =>
          totals.artists.slice(0, limit),
        ),
      artist: (artistId) => {
        const now = Date.now();
        return Effect.flatMap(
          store.playedArtistSongs(artistId, now),
          (plays): Effect.Effect<ArtistStats, LibraryStoreError> => {
            const stats = artistStats({ artistId, now, ...plays });
            if (!stats.played) return Effect.succeed(stats);
            const ranking = rankSongPlays(
              [
                ...stats.mostPlayed.map(({ id, ...totals }): SongPlayTotals => ({
                  ...totals,
                  song: { kind: "library", id },
                })),
                ...plays.streamedSongPlays,
              ],
              ARTIST_MOST_PLAYED,
            );
            return Effect.map(rankSongs(store, ranking), (mostPlayed) => ({
              ...stats,
              mostPlayed,
            }));
          },
        );
      },
      recaps: (now, between) => readRecapAvailability(store, now, between),
      recapHistoryVersion: store.listeningHistoryVersion,
      recap: (period) => Effect.suspend(() => loadRecap(store, period, Date.now())),
    };
  }),
);
