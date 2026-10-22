import { STATS_TOP, parseRecapId, type RecapPeriod, type StatsPeriod } from "@wave/core";
import * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import type { AlbumRow, ArtistRow, LibraryStoreError, SongRow } from "@/library/LibraryStore";
import { useFocusedVersion } from "@/lib/useFocusedVersion";
import { appRuntime } from "@/library/runtime";
import { playHistoryVersion } from "@/playback/PlayHistory";

import { useOpenedRecaps } from "./openedRecaps";
import { recapAnnouncement } from "./recapAnnouncement";
import { Stats, type ArtistStats, type LoadedRecap, type Ranked } from "./Stats";

/**
 * What `read` gives from Stats, or undefined while it first loads. Re-read
 * when the screen comes back into focus (windows end now), when `read`
 * changes and when a play starts or ends while it's focused. `read` must be stable.
 */
const useStatsRead = <A>(
  read: (stats: Stats["Service"]) => Effect.Effect<A, LibraryStoreError>,
): A | undefined => {
  const plays = useFocusedVersion(playHistoryVersion);
  const [value, setValue] = useState<A | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      appRuntime
        // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
        .runPromise(Stats.use(read))
        .then((result) => {
          if (current) setValue(result);
        })
        .catch(() => {
          // Keep showing the last good value.
        });
      return () => {
        current = false;
      };
      // `plays` isn't read in here: a change re-reads after a play.
      // oxlint-disable-next-line react-hooks/exhaustive-deps, react/memo-dependencies
    }, [read, plays]),
  );

  return value;
};

type ReadRanking<A> = (
  stats: Stats["Service"],
  period: StatsPeriod,
  limit: number,
) => Effect.Effect<readonly Ranked<A>[], LibraryStoreError>;

/** The top `limit` of a ranking for `period`, or undefined while it first loads. `read` must be stable. */
const useRanking = <A>(
  period: StatsPeriod,
  limit: number,
  read: ReadRanking<A>,
): readonly Ranked<A>[] | undefined =>
  useStatsRead(useCallback((stats) => read(stats, period, limit), [read, period, limit]));

const readTopSongs: ReadRanking<SongRow> = (stats, period, limit) => stats.topSongs(period, limit);

const readTopAlbums: ReadRanking<AlbumRow> = (stats, period, limit) =>
  stats.topAlbums(period, limit);

const readTopArtists: ReadRanking<ArtistRow> = (stats, period, limit) =>
  stats.topArtists(period, limit);

/**
 * An artist page's stats block for `artistId`, or undefined while it first
 * loads. Also re-read when the page's `songs` change (a scan or a deletion).
 */
export const useArtistStats = (
  artistId: number,
  songs: readonly unknown[],
): ArtistStats | undefined =>
  useStatsRead(
    // `songs` isn't read in here: a change re-reads the artist's songs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/memo-dependencies
    useCallback((stats: Stats["Service"]) => stats.artist(artistId), [artistId, songs]),
  );

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

const readRecaps = (stats: Stats["Service"]) => stats.recaps;

/** Every period with a Recap, newest first, or undefined while it first loads. */
export const useRecaps = (): readonly RecapPeriod[] | undefined => useStatsRead(readRecaps);

/** The new Recap Home announces; undefined while reading, null once there is none to announce. */
export const useRecapToAnnounce = (): RecapPeriod | null | undefined => {
  const recaps = useRecaps();
  const opened = useOpenedRecaps();
  return recapAnnouncement(recaps, opened);
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
