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
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
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

/** Stars with writes in flight; a star with none shows what `favorites` holds. */
const writing = new Map<number, FavoriteStar>();

/** Records the stars' new states and shows them, in one update however many there are. */
const showStars = (stars: ReadonlyMap<number, FavoriteStar>, saved: boolean): void => {
  for (const [trackId, star] of stars) {
    if (star.pending === 0) writing.delete(trackId);
    else writing.set(trackId, star);
  }
  favorites.update((state) => {
    let ids: Set<number> | undefined;
    for (const [trackId, star] of stars) {
      if (state.ids.has(trackId) === star.shown) continue;
      ids ??= new Set(state.ids);
      if (star.shown) ids.add(trackId);
      else ids.delete(trackId);
    }
    return {
      ...state,
      ids: ids ?? state.ids,
      edits: state.edits + 1,
      saved: saved ? state.saved + 1 : state.saved,
    };
  });
};

/**
 * Stars or unstars tracks (a selection's, say) with one write. Accepts queue
 * track ids (strings) as well.
 */
export const setFavorites = (
  trackIds: readonly (number | string)[],
  on: boolean,
): Promise<void> => {
  const ids = [...new Set(trackIds.map(Number))];
  if (ids.length === 0) return Promise.resolve();
  const current = favorites.get().ids;
  showStars(
    new Map(
      ids.map((id) => [id, starWriteStarted(writing.get(id) ?? favoriteStar(current.has(id)), on)]),
    ),
    false,
  );
  const settle = (saved: boolean | null) => () => {
    const settled = new Map<number, FavoriteStar>();
    for (const id of ids) {
      const star = writing.get(id);
      if (star !== undefined) settled.set(id, starWriteSettled(star, saved));
    }
    showStars(settled, saved !== null);
  };
  return (
    appRuntime
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      .runPromise(LibraryStore.use((store) => store.setFavorites(ids, on)))
      .then(settle(on), settle(null))
  );
};

/** Stars or unstars a track. Accepts a queue track id (a string) as well. */
export const setFavorite = (trackId: number | string, on: boolean): Promise<void> =>
  setFavorites([trackId], on);

/**
 * Unstars tracks that left the library (their files were deleted; the store
 * dropped their stars with them), so no star or Favorites list shows them.
 */
export const forgetFavorites = (trackIds: readonly number[]): void => {
  const gone = new Set(trackIds);
  for (const id of trackIds) writing.delete(id);
  favorites.update((state) => ({
    ...state,
    ids: new Set([...state.ids].filter((id) => !gone.has(id))),
    edits: state.edits + 1,
    saved: state.saved + 1,
  }));
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
