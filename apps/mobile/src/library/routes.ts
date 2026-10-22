import {
  detailPath,
  recapId,
  type DetailScreen,
  type RecapPeriod,
  type StatsPeriod,
  type StatsRanking,
} from "@wave/core";
import { useGlobalSearchParams, useLocalSearchParams, usePathname, type Href } from "expo-router";
import { router } from "@/lib/timingRouter";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";

import { continueTiming, timingRouteCommitted } from "@/lib/timing";
import { makeExternalStore } from "@/lib/externalStore";
import { noteScreen } from "@/log/appLog";

import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow } from "./LibraryStore";

/** The route showing: its path and its params (the global ones, every segment's). */
export interface CurrentRoute {
  readonly pathname: string;
  readonly params: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * The route showing, for opening screens from outside React and for
 * components that follow it (`useCurrentRoute`). expo-router's own hooks read
 * a context that changes on every navigation, so each caller renders again on
 * every push, pop and tab switch; this store lets an always-mounted component
 * pick the part it needs, or stop following while it's hidden.
 */
const currentRoute = makeExternalStore<CurrentRoute>({ pathname: "/", params: {} });

/**
 * Keeps the current route's store up to date. Rendered once, by the root
 * layout: it renders nothing, so following the route renders only it. It
 * writes before the frame is drawn, so followers draw the new route with it.
 */
export function FollowCurrentRoute(): null {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  useLayoutEffect(() => currentRoute.set({ pathname, params }), [pathname, params]);
  // The app log's freezes say which screen was showing.
  useLayoutEffect(() => {
    noteScreen(pathname);
    timingRouteCommitted(pathname);
  }, [pathname]);
  return null;
}

const idle = () => () => {};

/**
 * [select]ed from the route showing (return a primitive or a stable value).
 * The caller renders again when the selection changes, and only while
 * [active]: inactive, the selection is read when it renders for another
 * reason (Now Playing reads it as it opens, not on every navigation under it).
 */
export const useCurrentRoute = <A>(select: (route: CurrentRoute) => A, active = true): A =>
  useSyncExternalStore(active ? currentRoute.subscribe : idle, () => select(currentRoute.get()));

const pathOf = (route: CurrentRoute): string => route.pathname;

/** The path showing now, unfollowed: for what runs outside a render (a swipe). */
export const currentPath = (): string => currentRoute.get().pathname;

/** The route showing now, unfollowed: for what a row reads as it renders and a swipe reads as it runs. */
export const currentRouteNow = (): CurrentRoute => currentRoute.get();

/** The path showing, followed while [active] (`useCurrentRoute`). */
export const useCurrentPath = (active = true): string => useCurrentRoute(pathOf, active);

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
  if (screen === "album" && /\/artist\//.test(currentRoute.get().pathname)) {
    continueTiming("albumLink", detailPath(currentRoute.get().pathname, screen, id));
  }
  opening = known === undefined || known === null ? undefined : { screen, row: known };
  router.push(`${detailPath(currentRoute.get().pathname, screen, id)}${query}` as Href);
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
 * otherwise it opens on Library and waits for Online to be picked.
 */
export const openAlbum = (id: number, known?: AlbumRow | null, from?: DetailOpening): void =>
  open("album", id, known, integratedQuery(from));

/**
 * Opens a Library artist. Opened integrated ([from], from a streamed song's
 * artist), their page asks YouTube Music on its own when nothing stands for
 * them (Core's `ytArtistSectionAsks`); otherwise it opens on Library and waits
 * for Online to be picked.
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

/** A Recap's stories, full screen over everything (read back with Core's `parseRecapId`). */
const recapHref = (period: RecapPeriod) => `/recap/${recapId(period)}` as const;
export const openRecap = (period: RecapPeriod): void => router.push(recapHref(period));

/** Parses a route's `[id]` param; NaN-safe (an unknown id shows the "gone" state). */
export const parseId = (param: string | string[] | undefined): number => {
  const id = Number(Array.isArray(param) ? param[0] : param);
  return Number.isInteger(id) ? id : -1;
};
