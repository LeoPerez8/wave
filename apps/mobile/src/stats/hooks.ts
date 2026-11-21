import { useLocalisation } from "@/localisation/localisation";
import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import {
  STATS_SEE_ALL,
  STATS_TOP,
  homeRecapVisibility,
  startHomeRecap,
  parseRecapId,
  type RecapPeriod,
  type RecapGenre,
  type StatsPeriod,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import type { LibraryStoreError } from "@/library/LibraryStore";
import {
  libraryQuery,
  libraryQueryResult,
  useLibraryQuery,
  type LibraryQuery,
} from "@/library/sharedQueries";

import { useFocusedVersion } from "@/lib/useFocusedVersion";
import { appRuntime } from "@/library/runtime";
import { playHistoryVersion } from "@/playback/PlayHistory";
import { useScreenSight } from "@/lib/screenSight";

import { getOpenedRecaps } from "./openedRecaps";
import { knownRecaps, useRecapAvailability } from "./recapAvailabilityLive";
import { Stats, type ArtistStats, type LoadedRecap, type Ranked, type StatsSong } from "./Stats";

/** A Stats read's result with what it reflects: the play history's version and the caller's `sources`. */
interface StatsReading<A> {
  readonly value: A;
  readonly plays: number;
  readonly sources: unknown;
  readonly language: string;
}

/**
 * What `read` gives from Stats, or undefined while it first loads. Re-read
 * when the screen comes back into focus (windows end now), when `read` or
 * `sources` change (an artist page's songs after a scan) and when a play
 * starts or ends while it's focused. `read` must be stable.
 *
 * The reading keeps the version and sources it reflects, so the read depends
 * on values it reads: the React Compiler keeps a hook's memo dependencies only
 * when the memo reads them (docs/performance/728-react-compiler.md).
 */
const useStatsRead = <A>(
  read: (stats: Stats["Service"]) => Effect.Effect<A, LibraryStoreError>,
  sources: unknown = null,
): A | undefined => {
  const { language } = useLocalisation();
  const plays = useFocusedVersion(playHistoryVersion);
  const [reading, setReading] = useState<StatsReading<A> | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      appRuntime
        // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
        .runPromise(Stats.use(read))
        .then((value) => {
          if (current) setReading({ value, plays, sources, language });
        })
        .catch(() => {
          // Keep showing the last good value.
        });
      return () => {
        current = false;
      };
    }, [read, plays, sources, language]),
  );

  return reading?.value;
};

const rankingKey = (name: string, period: StatsPeriod, limit: number): string =>
  `stats:${name}:${period}:${limit}`;

/** Stats reads every counted play and the songs it credits. */
const STATS_READS = { plays: true, tracks: true } as const;

/**
 * Stats' queries, shared like the Library's (`sharedQueries.ts`): one read serves Stats, See all
 * and the kept copy, and a counted play or a scan re-reads them. A rolling period moves with
 * those re-reads. Made once per key.
 */
const statsQueries = new Map<string, LibraryQuery<unknown>>();
const statsQuery = <A>(
  key: string,
  read: (stats: Stats["Service"]) => Effect.Effect<A, LibraryStoreError>,
): LibraryQuery<A> => {
  let query = statsQueries.get(key);
  if (query === undefined) {
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    query = libraryQuery(key, STATS_READS, Stats.use(read)) as LibraryQuery<unknown>;
    statsQueries.set(key, query);
  }
  return query as LibraryQuery<A>;
};

type ReadRanking<A> = (
  stats: Stats["Service"],
  period: StatsPeriod,
  limit: number,
) => Effect.Effect<readonly Ranked<A>[], LibraryStoreError>;

const rankingQuery = <A>(
  name: string,
  period: StatsPeriod,
  limit: number,
  read: ReadRanking<A>,
): LibraryQuery<readonly Ranked<A>[]> =>
  statsQuery(rankingKey(name, period, limit), (stats) => read(stats, period, limit));

/**
 * The top `limit` of a ranking for `period`. Until its own read answers: See all draws the top
 * of Stats, already in memory, and a period just chosen keeps the last period's ranking, so
 * neither draws a placeholder. Undefined only when nothing of it was read yet.
 */
const useRanking = <A>(
  name: string,
  period: StatsPeriod,
  limit: number,
  read: ReadRanking<A>,
): readonly Ranked<A>[] | undefined => {
  const top = useLibraryQuery<readonly Ranked<A>[] | undefined>(
    limit > STATS_TOP ? rankingQuery(name, period, STATS_TOP, read) : null,
    undefined,
  );
  const ranking = useLibraryQuery<readonly Ranked<A>[] | undefined>(
    rankingQuery(name, period, limit, read),
    undefined,
  );
  return useLastShown(ranking ?? top);
};

/** [value], or the last defined one while it is undefined. */
const useLastShown = <A>(value: A | undefined): A | undefined => {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
};

const readTopSongs: ReadRanking<StatsSong> = (stats, period, limit) =>
  stats.topSongs(period, limit);

const readTopAlbums: ReadRanking<PlayedAlbum> = (stats, period, limit) =>
  stats.topAlbums(period, limit);

const readTopArtists: ReadRanking<PlayedArtist> = (stats, period, limit) =>
  stats.topArtists(period, limit);

const topGenresQuery = (period: StatsPeriod): LibraryQuery<readonly RecapGenre[]> =>
  statsQuery(`stats:topGenres:${period}`, (stats) => stats.topGenres(period));

/**
 * An artist page's stats block for `artistId`, or undefined while it first
 * loads. Also re-read when the page's `songs` change (a scan or a deletion).
 */
export const useArtistStats = (
  artistId: number,
  songs: readonly unknown[],
): ArtistStats | undefined => {
  const { strings } = useLocalisation();
  return useStatsRead(
    useCallback((stats: Stats["Service"]) => stats.artist(artistId, strings), [artistId, strings]),
    songs,
  );
};

/** Top songs: the `limit` songs played most in `period` (10 on Stats, 100 in See all). */
export const useTopSongs = (
  period: StatsPeriod,
  limit: number = STATS_TOP,
): readonly Ranked<StatsSong>[] | undefined => useRanking("topSongs", period, limit, readTopSongs);

/** Top albums: the `limit` albums played most in `period`. */
export const useTopAlbums = (
  period: StatsPeriod,
  limit: number = STATS_TOP,
): readonly Ranked<PlayedAlbum>[] | undefined =>
  useRanking("topAlbums", period, limit, readTopAlbums);

/** Top artists: the `limit` artists played most in `period`, credited by track artist. */
export const useTopArtists = (
  period: StatsPeriod,
  limit: number = STATS_TOP,
): readonly Ranked<PlayedArtist>[] | undefined =>
  useRanking("topArtists", period, limit, readTopArtists);

/** Every period with a Recap, newest first, or undefined while it first loads. */
export const useRecaps = useRecapAvailability;

/** Home adopts new availability only when it becomes visible, keeping this visit's layout. */
export const useRecapToAnnounce = (painted: boolean): RecapPeriod | null => {
  const sight = useScreenSight();
  useRecapAvailability(painted);
  const readVisible = useCallback(
    () => sight.visible() && AppState.currentState === "active",
    [sight],
  );
  const [announcement, setAnnouncement] = useState(() =>
    startHomeRecap({
      available: knownRecaps(),
      opened: getOpenedRecaps(),
      visible: readVisible(),
    }),
  );
  useEffect(() => {
    const update = () => {
      const input = {
        visible: readVisible(),
        available: knownRecaps(),
        opened: getOpenedRecaps(),
      };
      setAnnouncement((current) => homeRecapVisibility(current, input));
    };
    const stop = sight.subscribe(update);
    const activity = AppState.addEventListener("change", update);
    update();
    return () => {
      stop();
      activity.remove();
    };
  }, [sight, readVisible]);
  return announcement.period;
};

/**
 * The Recap a route's `id` names (Core's `recapId`), or undefined while it
 * first loads; null when the id names no Recap available now.
 */
export const useRecap = (id: string): LoadedRecap | null | undefined =>
  useStatsRead(
    useCallback(
      (stats: Stats["Service"]) => {
        const period = parseRecapId(id);
        return period === null ? Effect.succeed(null) : stats.recap(period);
      },
      [id],
    ),
  );

/** The period's top five genre shares, refreshed with Stats' other readings. */
export const useTopGenres = (period: StatsPeriod): readonly RecapGenre[] | undefined =>
  useLastShown(
    useLibraryQuery<readonly RecapGenre[] | undefined>(topGenresQuery(period), undefined),
  );

/** The period Stats opens on. */
export const STATS_OPENING_PERIOD: StatsPeriod = "month";

/**
 * What Stats and its See all open on, kept in memory from startup (`readyScreens.ts`, #1352):
 * the opening period's rankings, their See all lists and its genres. Seven queries, each re-read
 * on a counted play; the other periods are read when chosen.
 */
export const statsOpeningQueries = (): readonly LibraryQuery<unknown>[] => {
  const period = STATS_OPENING_PERIOD;
  return [
    rankingQuery("topSongs", period, STATS_TOP, readTopSongs),
    rankingQuery("topAlbums", period, STATS_TOP, readTopAlbums),
    rankingQuery("topArtists", period, STATS_TOP, readTopArtists),
    topGenresQuery(period),
    rankingQuery("topSongs", period, STATS_SEE_ALL, readTopSongs),
    rankingQuery("topAlbums", period, STATS_SEE_ALL, readTopAlbums),
    rankingQuery("topArtists", period, STATS_SEE_ALL, readTopArtists),
  ] as readonly LibraryQuery<unknown>[];
};

/** The top artists of Stats' opening period, read once kept (`statsOpeningQueries`). */
export const statsOpeningArtists = async (): Promise<readonly Ranked<PlayedArtist>[]> =>
  (await libraryQueryResult(
    rankingQuery("topArtists", STATS_OPENING_PERIOD, STATS_TOP, readTopArtists),
  )) ?? [];
