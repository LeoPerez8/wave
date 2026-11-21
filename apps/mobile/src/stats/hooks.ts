import { useLocalisation } from "@/localisation/localisation";
import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import {
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
  /** What the reading is kept under for the session (`STATS_KEPT`), or none. */
  keptAs?: string,
): A | undefined => {
  const { language } = useLocalisation();
  const kept = keptAs === undefined ? undefined : `${keptAs}:${language}`;
  const plays = useFocusedVersion(playHistoryVersion);
  const [reading, setReading] = useState<StatsReading<A> | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      appRuntime
        // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
        .runPromise(Stats.use(read))
        .then((value) => {
          if (kept !== undefined) keepReading(kept, value);
          if (current) setReading({ value, plays, sources, language });
        })
        .catch(() => {
          // Keep showing the last good value.
        });
      return () => {
        current = false;
      };
    }, [read, plays, sources, language, kept]),
  );

  // Until this visit's reading arrives, the last one kept: the screen opens on it (#1352).
  return reading?.value ?? (kept === undefined ? undefined : (keptReadings.get(kept) as A));
};

/**
 * How many Stats readings are kept for the session: each a ranking's top or a
 * genre podium (a few dozen rows), so Stats and its See all open on them and
 * update in place when the visit's own reading arrives.
 */
export const STATS_KEPT = 32;
const keptReadings = new Map<string, unknown>();

const keepReading = (key: string, value: unknown): void => {
  keptReadings.delete(key);
  keptReadings.set(key, value);
  while (keptReadings.size > STATS_KEPT) {
    const oldest = keptReadings.keys().next().value as string;
    keptReadings.delete(oldest);
  }
};

const rankingKey = (name: string, period: StatsPeriod, limit: number): string =>
  `${name}:${period}:${limit}`;

type ReadRanking<A> = (
  stats: Stats["Service"],
  period: StatsPeriod,
  limit: number,
) => Effect.Effect<readonly Ranked<A>[], LibraryStoreError>;

/** The top `limit` of a ranking for `period`, or undefined while it first loads. `read` must be stable. */
const useRanking = <A>(
  name: string,
  period: StatsPeriod,
  limit: number,
  read: ReadRanking<A>,
): readonly Ranked<A>[] | undefined =>
  useStatsRead(
    useCallback((stats) => read(stats, period, limit), [read, period, limit]),
    null,
    rankingKey(name, period, limit),
  );

const readTopSongs: ReadRanking<StatsSong> = (stats, period, limit) =>
  stats.topSongs(period, limit);

const readTopAlbums: ReadRanking<PlayedAlbum> = (stats, period, limit) =>
  stats.topAlbums(period, limit);

const readTopArtists: ReadRanking<PlayedArtist> = (stats, period, limit) =>
  stats.topArtists(period, limit);

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
  useStatsRead(
    useCallback((stats: Stats["Service"]) => stats.topGenres(period), [period]),
    null,
    `topGenres:${period}`,
  );

/** The top artists of Stats' opening period as last read, or none yet (`readStatsOpening`). */
export const statsOpeningArtists = (language: string): readonly Ranked<PlayedArtist>[] =>
  (keptReadings.get(`${rankingKey("topArtists", STATS_OPENING_PERIOD, STATS_TOP)}:${language}`) as
    | readonly Ranked<PlayedArtist>[]
    | undefined) ?? [];

/** The period Stats opens on. */
export const STATS_OPENING_PERIOD: StatsPeriod = "month";

/**
 * Reads what Stats opens on (its opening period's rankings and genres) into
 * the kept readings, one read per free turn, so its first frame draws them
 * (`readyScreens.ts`, #1352).
 */
export const readStatsOpening = async (
  language: string,
  turn: () => Promise<void>,
): Promise<void> => {
  const period = STATS_OPENING_PERIOD;
  const reads: readonly (readonly [
    string,
    (stats: Stats["Service"]) => Effect.Effect<unknown, LibraryStoreError>,
  ])[] = [
    [rankingKey("topSongs", period, STATS_TOP), (stats) => readTopSongs(stats, period, STATS_TOP)],
    [
      rankingKey("topAlbums", period, STATS_TOP),
      (stats) => readTopAlbums(stats, period, STATS_TOP),
    ],
    [
      rankingKey("topArtists", period, STATS_TOP),
      (stats) => readTopArtists(stats, period, STATS_TOP),
    ],
    [`topGenres:${period}`, (stats) => stats.topGenres(period)],
  ];
  for (const [key, read] of reads) {
    await turn();
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    const value = await appRuntime.runPromise(Stats.use(read)).catch(() => undefined);
    if (value !== undefined) keepReading(`${key}:${language}`, value);
  }
};
