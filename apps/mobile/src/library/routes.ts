import { detailPath, type DetailScreen, type StatsPeriod, type StatsRanking } from "@wave/core";
import { router, usePathname, type Href } from "expo-router";
import { useEffect } from "react";

/** The current screen's path, for opening screens from outside React. */
let here = "/";

/** Keeps `here` current. Called once, by the root layout. */
export const useTrackCurrentPath = (): void => {
  const pathname = usePathname();
  useEffect(() => {
    here = pathname;
  }, [pathname]);
};

/**
 * Opens a detail screen (ids are DB integer ids): inside the shortcut tab when
 * opened from it, on the Library stack otherwise (Core's `detailPath`).
 */
const open = (screen: DetailScreen, id: number): void =>
  router.push(detailPath(here, screen, id) as Href);

export const openAlbum = (id: number): void => open("album", id);
export const openArtist = (id: number): void => open("artist", id);
export const openGenre = (id: number): void => open("genre", id);
export const openFolder = (id: number): void => open("folder", id);
export const openPlaylist = (id: number): void => open("playlist", id);

/** Stats, pushed from Home; a Library stack screen so the mini player stays. */
export const statsHref = "/library/stats" as const;
export const openStats = (): void => router.push(statsHref);

/** A ranking's See all, for the period selected on Stats (read back with Core's `statsSeeAll`). */
export const statsSeeAllHref = (ranking: StatsRanking, period: StatsPeriod) =>
  `/library/stats/${ranking}?period=${period}` as const;
export const openStatsSeeAll = (ranking: StatsRanking, period: StatsPeriod): void =>
  router.push(statsSeeAllHref(ranking, period));

/** Parses a route's `[id]` param; NaN-safe (an unknown id shows the "gone" state). */
export const parseId = (param: string | string[] | undefined): number => {
  const id = Number(Array.isArray(param) ? param[0] : param);
  return Number.isInteger(id) ? id : -1;
};
