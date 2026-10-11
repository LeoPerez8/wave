import { favoriteStar, starWriteSettled, starWriteStarted, type FavoriteStar } from "@wave/core";
import { useEffect, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";

import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * Favorites (starred tracks), held in memory so every star (track rows, the
 * long-press menu, Now Playing) flips at once and stays in sync. Writes go to
 * the store behind the scenes; should they fail, the star goes back to what the
 * store holds (Core's `FavoriteStar`).
 */
interface FavoritesState {
  readonly ids: ReadonlySet<number>;
  readonly loaded: boolean;
  /** Bumped when a star is toggled, and when its write settles. */
  readonly edits: number;
  /** Bumped once a toggle is saved; the Favorites list re-reads on it. */
  readonly saved: number;
}

const favorites = makeExternalStore<FavoritesState>({
  ids: new Set(),
  loaded: false,
  edits: 0,
  saved: 0,
});

let loading = false;

const loadFavorites = (): void => {
  if (loading || favorites.get().loaded) return;
  loading = true;
  const edits = favorites.get().edits;
  void appRuntime
    .runPromise(LibraryStore.use((store) => store.favoriteTrackIds))
    .then((ids) => {
      loading = false;
      // A star toggled while loading may not be in the result; read again.
      if (favorites.get().edits !== edits) return loadFavorites();
      favorites.update((state) => ({ ...state, ids: new Set(ids), loaded: true }));
    })
    .catch(() => {
      loading = false;
    });
};

const withStar = (ids: ReadonlySet<number>, trackId: number, on: boolean): ReadonlySet<number> => {
  const next = new Set(ids);
  if (on) next.add(trackId);
  else next.delete(trackId);
  return next;
};

/** Stars with writes in flight; a star with none shows what `favorites` holds. */
const writing = new Map<number, FavoriteStar>();

/** Records a star's new state and shows it. */
const showStar = (trackId: number, star: FavoriteStar, saved: boolean): void => {
  if (star.pending === 0) writing.delete(trackId);
  else writing.set(trackId, star);
  favorites.update((state) => ({
    ...state,
    ids:
      state.ids.has(trackId) === star.shown ? state.ids : withStar(state.ids, trackId, star.shown),
    edits: state.edits + 1,
    saved: saved ? state.saved + 1 : state.saved,
  }));
};

/** Stars or unstars a track. Accepts a queue track id (a string) as well. */
export const setFavorite = (trackId: number | string, on: boolean): Promise<void> => {
  const id = Number(trackId);
  const star = writing.get(id) ?? favoriteStar(favorites.get().ids.has(id));
  showStar(id, starWriteStarted(star, on), false);
  const settle = (saved: boolean | null) => () => {
    const current = writing.get(id);
    if (current !== undefined) showStar(id, starWriteSettled(current, saved), saved !== null);
  };
  return appRuntime
    .runPromise(LibraryStore.use((store) => store.setFavorite(id, on)))
    .then(settle(on), settle(null));
};

export const isFavorite = (trackId: number | string): boolean =>
  favorites.get().ids.has(Number(trackId));

/** Flips a track's star. */
export const toggleFavorite = (trackId: number | string): Promise<void> =>
  setFavorite(trackId, !isFavorite(trackId));

const useFavoritesState = (): FavoritesState => {
  useEffect(loadFavorites, []);
  return useSyncExternalStore(favorites.subscribe, favorites.get);
};

/** The ids of every starred track (for marking rows in a list). */
export const useFavoriteIds = (): ReadonlySet<number> => useFavoritesState().ids;

/** Whether a track is starred; takes a SongRow id or a queue track id (Now Playing). */
export const useIsFavorite = (trackId: number | string | null): boolean => {
  useEffect(loadFavorites, []);
  return useSyncExternalStore(favorites.subscribe, () =>
    trackId === null ? false : favorites.get().ids.has(Number(trackId)),
  );
};

/** Changes whenever a star has been saved (re-run queries over favorites on it). */
export const useFavoritesSaved = (): number =>
  useSyncExternalStore(favorites.subscribe, () => favorites.get().saved);
