import { STATS_TOP, type StatsPeriod } from "@wave/core";
import type * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, useSyncExternalStore } from "react";

import type { AlbumRow, ArtistRow, LibraryStoreError, SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { playHistoryVersion } from "@/playback/PlayHistory";

import { Stats, type Ranked } from "./Stats";

/**
 * The top `limit` of a ranking for `period`, or undefined while it first
 * loads. Re-read when the screen comes back into focus (the window ends now),
 * when the period changes and when a play starts or ends. `read` must be stable.
 */
const useRanking = <A>(
  period: StatsPeriod,
  limit: number,
  read: (
    stats: Stats["Service"],
    period: StatsPeriod,
    limit: number,
  ) => Effect.Effect<readonly Ranked<A>[], LibraryStoreError>,
): readonly Ranked<A>[] | undefined => {
  const plays = useSyncExternalStore(playHistoryVersion.subscribe, playHistoryVersion.get);
  const [ranking, setRanking] = useState<readonly Ranked<A>[] | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      appRuntime
        .runPromise(Stats.use((stats) => read(stats, period, limit)))
        .then((result) => {
          if (current) setRanking(result);
        })
        .catch(() => {
          // Keep showing the last good ranking.
        });
      return () => {
        current = false;
      };
      // `plays` isn't read in here: a change re-reads the ranking after a play.
      // oxlint-disable-next-line react-hooks/exhaustive-deps, react/memo-dependencies
    }, [period, limit, read, plays]),
  );

  return ranking;
};

const readTopSongs = (stats: Stats["Service"], period: StatsPeriod, limit: number) =>
  stats.topSongs(period, limit);

const readTopAlbums = (stats: Stats["Service"], period: StatsPeriod, limit: number) =>
  stats.topAlbums(period, limit);

const readTopArtists = (stats: Stats["Service"], period: StatsPeriod, limit: number) =>
  stats.topArtists(period, limit);

/** Top songs: the `limit` songs played most in `period` (10 on Stats, 100 in See all). */
export const useTopSongs = (
  period: StatsPeriod,
  limit: number = STATS_TOP,
): readonly Ranked<SongRow>[] | undefined => useRanking(period, limit, readTopSongs);

/** Top albums: the `limit` albums played most in `period`. */
export const useTopAlbums = (
  period: StatsPeriod,
  limit: number = STATS_TOP,
): readonly Ranked<AlbumRow>[] | undefined => useRanking(period, limit, readTopAlbums);

/** Top artists: the `limit` artists played most in `period`, credited by track artist. */
export const useTopArtists = (
  period: StatsPeriod,
  limit: number = STATS_TOP,
): readonly Ranked<ArtistRow>[] | undefined => useRanking(period, limit, readTopArtists);
