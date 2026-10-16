import { detailPath, type DetailScreen, type StatsPeriod, type StatsRanking } from "@wave/core";
import { router, useLocalSearchParams, usePathname, type Href } from "expo-router";
import { useEffect, useState } from "react";

import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow } from "./LibraryStore";

/** The current screen's path, for opening screens from outside React. */
let here = "/";

/** Keeps `here` current. Called once, by the root layout. */
export const useTrackCurrentPath = (): void => {
  const pathname = usePathname();
  useEffect(() => {
    here = pathname;
  }, [pathname]);
};

/** The row a list shows for each detail screen's item. */
interface DetailRows {
  readonly album: AlbumRow;
  readonly artist: ArtistRow;
  readonly genre: GenreRow;
  readonly playlist: PlaylistRow;
}

/** The row of the item last opened from a list that had it, for its screen's first frame. */
let opening: { readonly screen: DetailScreen; readonly row: { readonly id: number } } | undefined;

/**
 * Opens a detail screen (ids are DB integer ids): inside the section tab it's
 * opened from, on the Library stack otherwise (Core's `detailPath`). Given
 * the row the tapped list shows ([known]), the screen draws its header from it
 * on its first frame instead of waiting for its whole query (`useKnownRow`).
 */
const open = <S extends DetailScreen>(
  screen: S,
  id: number,
  known?: DetailRows[S] | null,
  query = "",
): void => {
  opening = known === undefined || known === null ? undefined : { screen, row: known };
  router.push(`${detailPath(here, screen, id)}${query}` as Href);
};

/**
 * How an album or artist was opened: integrated, for an album from an
 * integrated view (Search showing YT Music, an integrated artist page), for
 * an artist from a streamed song.
 */
export interface DetailOpening {
  readonly integrated: boolean;
}

/** The route param an integrated opening adds (read back by `useOpenedIntegrated`). */
const integratedQuery = (from: DetailOpening | undefined): string =>
  from?.integrated === true ? "?integrated=1" : "";

/**
 * Opens a Library album. Opened from an integrated view ([from]), it reads
 * its release on YouTube Music on its own (Core's `ytLibraryAlbumView`);
 * otherwise it waits for Show on YouTube Music.
 */
export const openAlbum = (id: number, known?: AlbumRow | null, from?: DetailOpening): void =>
  open("album", id, known, integratedQuery(from));

/**
 * Opens a Library artist. Opened integrated ([from], from a streamed song's
 * artist), their page asks YouTube Music on its own when nothing stands for
 * them (Core's `ytArtistSectionAsks`); otherwise it waits for Show on YouTube
 * Music.
 */
export const openArtist = (id: number, known?: ArtistRow | null, from?: DetailOpening): void =>
  open("artist", id, known, integratedQuery(from));
export const openGenre = (id: number, known?: GenreRow | null): void => open("genre", id, known);
export const openPlaylist = (id: number, known?: PlaylistRow | null): void =>
  open("playlist", id, known);

/** Whether the album or artist screen was opened integrated (`openAlbum`'s, `openArtist`'s [from]). */
export const useOpenedIntegrated = (): boolean =>
  useLocalSearchParams<{ integrated?: string }>().integrated === "1";

/**
 * What the list or link knew about the item a detail screen shows when it was
 * tapped (`open*(id, row)`; links read theirs ahead with `useLinkRows`), read
 * once as the screen mounts; undefined when it wasn't known yet.
 */
export const useKnownRow = <S extends DetailScreen>(
  screen: S,
  id: number,
): DetailRows[S] | undefined => {
  const [known] = useState(() =>
    opening?.screen === screen && opening.row.id === id
      ? (opening.row as DetailRows[S])
      : undefined,
  );
  return known;
};

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
