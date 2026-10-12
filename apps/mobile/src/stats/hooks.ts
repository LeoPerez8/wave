import { STATS_SEE_ALL, STATS_TOP, type StatsPeriod } from "@wave/core";
import type * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, useSyncExternalStore } from "react";

import type { AlbumRow, ArtistRow, LibraryStoreError, SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { playHistoryVersion } from "@/playback/PlayHistory";

import { Stats, type Ranked } from "./Stats";

/**
 * A ranking for `period`, or undefined while it first loads. Re-read when the
 * screen comes back into focus (the window ends now), when the period changes
 * and when a play starts or ends.
 */
export const useRanking = <A>(
  period: StatsPeriod,
  read: (
    stats: Stats["Service"],
    period: StatsPeriod,
  ) => Effect.Effect<readonly Ranked<A>[], LibraryStoreError>,
): readonly Ranked<A>[] | undefined => {
  const plays = useSyncExternalStore(playHistoryVersion.subscribe, playHistoryVersion.get);
  const [ranking, setRanking] = useState<readonly Ranked<A>[] | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      appRuntime
        .runPromise(Stats.use((stats) => read(stats, period)))
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
    }, [period, read, plays]),
  );

  return ranking;
};

const readTopSongs = (stats: Stats["Service"], period: StatsPeriod) =>
  stats.topSongs(period, STATS_TOP);

/** Stats › Top Songs: the 10 songs played most in `period`. */
export const useTopSongs = (period: StatsPeriod): readonly Ranked<SongRow>[] | undefined =>
  useRanking(period, readTopSongs);

const readTopAlbums = (stats: Stats["Service"], period: StatsPeriod) =>
  stats.topAlbums(period, STATS_TOP);

/** Stats › Top Albums: the 10 albums played most in `period`. */
export const useTopAlbums = (period: StatsPeriod): readonly Ranked<AlbumRow>[] | undefined =>
  useRanking(period, readTopAlbums);

const readTopArtists = (stats: Stats["Service"], period: StatsPeriod) =>
  stats.topArtists(period, STATS_TOP);

/** Stats › Top Artists: the 10 artists played most in `period`, credited by track artist. */
export const useTopArtists = (period: StatsPeriod): readonly Ranked<ArtistRow>[] | undefined =>
  useRanking(period, readTopArtists);
const readAllTopSongs = (stats: Stats["Service"], period: StatsPeriod) =>
  stats.topSongs(period, STATS_SEE_ALL);

/** See all › Top songs: the 100 songs played most in `period`. */
export const useAllTopSongs = (period: StatsPeriod): readonly Ranked<SongRow>[] | undefined =>
  useRanking(period, readAllTopSongs);

const readAllTopAlbums = (stats: Stats["Service"], period: StatsPeriod) =>
  stats.topAlbums(period, STATS_SEE_ALL);

/** See all › Top albums: the 100 albums played most in `period`. */
export const useAllTopAlbums = (period: StatsPeriod): readonly Ranked<AlbumRow>[] | undefined =>
  useRanking(period, readAllTopAlbums);

const readAllTopArtists = (stats: Stats["Service"], period: StatsPeriod) =>
  stats.topArtists(period, STATS_SEE_ALL);

/** See all › Top artists: the 100 artists played most in `period`, credited by track artist. */
export const useAllTopArtists = (period: StatsPeriod): readonly Ranked<ArtistRow>[] | undefined =>
  useRanking(period, readAllTopArtists);
