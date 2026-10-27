import {
  favoriteStar,
  parseTrackId,
  starWriteSettled,
  starWriteStarted,
  ytSongStarred,
  type FavoriteStar,
  type PendingFavorite,
} from "@wave/core";
import { useEffect, useSyncExternalStore } from "react";

import { makeExternalStore, subscribeAll } from "@/lib/externalStore";
import { useSightedStore } from "@/lib/screenSight";

import {
  onSavedStars,
  publishLibraryChange,
  publishStarred,
  publishUnstarred,
} from "./libraryChanges";
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
  /** Bumped once a toggle is saved; sync follows it (`onFavoritesSaved`). */
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
/** Individually known stars do not mark the whole favorites list loaded. */
const knownStars = new Map<number, boolean>();
const knownPending = new Map<string, boolean>();

/** Records the stars' new states and shows them, in one update however many there are. */
const showStars = (stars: ReadonlyMap<number, FavoriteStar>, saved: boolean): void => {
  for (const [trackId, star] of stars) {
    knownStars.set(trackId, star.shown);
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
  if (saved) publishLibraryChange({ kind: "favorites", ids: [...stars.keys()] });
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
  if (on) publishStarred(ids.filter((id) => !current.has(id)));
  else publishUnstarred(ids.filter((id) => current.has(id)).map(String));
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
const setFavorite = (trackId: number | string, on: boolean): Promise<void> =>
  setFavorites([trackId], on);

/**
 * Unstars tracks that left the library (their files were deleted; the store
 * dropped their stars with them), so no star or Favorites list shows them.
 */
export const forgetFavorites = (trackIds: readonly number[]): void => {
  const gone = new Set(trackIds);
  for (const id of trackIds) {
    writing.delete(id);
    knownStars.set(id, false);
  }
  favorites.update((state) => ({
    ...state,
    ids: new Set([...state.ids].filter((id) => !gone.has(id))),
    edits: state.edits + 1,
    saved: state.saved + 1,
  }));
  publishLibraryChange({ kind: "favorites", ids: trackIds });
};

export const isFavorite = (trackId: number | string): boolean =>
  favorites.get().ids.has(Number(trackId));

/**
 * The ids of every starred track as the store holds them now, unfollowed: for
 * what a row works out as it renders or as a swipe runs, without every row
 * following the stars (`useFavoriteIds` follows them).
 */
export const favoriteIdsNow = (): ReadonlySet<number> => favorites.get().ids;

/** Flips a track's star. */
export const toggleFavorite = (trackId: number | string): Promise<void> =>
  setFavorite(trackId, !isFavorite(trackId));

const useLoadedFavorites = (active: boolean): void => {
  useEffect(() => {
    if (active) loadFavorites();
  }, [active]);
};

/**
 * The ids of every starred track (for marking rows in a list). A screen out of
 * sight doesn't follow them; it catches up when it comes back (`useSightedStore`).
 */
export const useFavoriteIds = (active = true): ReadonlySet<number> => {
  useLoadedFavorites(active);
  return useSightedStore(favorites.subscribe, favoriteIdsNow);
};

/** `useFavoriteIds` followed whether or not a screen is in sight: for menus and Now Playing. */
export const useLiveFavoriteIds = (active = true): ReadonlySet<number> => {
  useLoadedFavorites(active);
  return useSyncExternalStore(favorites.subscribe, favoriteIdsNow);
};

/**
 * Whether a track is starred; takes a SongRow id or a queue track id (Now
 * Playing). A YT Music song's (`yt:<videoId>`) is its pending favorite:
 * starred, its file on its way.
 */
export const useIsFavorite = (trackId: number | string | null): boolean => {
  const ref = typeof trackId === "string" ? parseTrackId(trackId) : null;
  const video = ref?.kind === "yt" ? ref.videoId : null;
  const pendingStar = video !== null;
  useEffect(() => {
    if (pendingStar) loadPendingFavorites();
    else loadFavorites();
  }, [pendingStar]);
  return useSyncExternalStore(
    video === null ? favorites.subscribe : pendingFavorites.subscribe,
    () =>
      video !== null
        ? pendingFavorites.get().videos.has(video)
        : trackId !== null && favorites.get().ids.has(Number(trackId)),
  );
};

/**
 * The starred tracks as the store holds them now, read afresh, with the stars
 * whose writes are still in flight showing what was asked.
 */
export const currentFavoriteIds = (): Promise<ReadonlySet<number>> =>
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.favoriteTrackIds))
    .then((ids) => {
      const shown = new Set(ids);
      for (const [id, star] of writing) {
        if (star.shown) shown.add(id);
        else shown.delete(id);
      }
      return shown;
    });

/**
 * Reads the stars again after they changed outside this phone's own toggles
 * (the Wave account sent some): stars with a write in flight keep showing
 * what was asked, and lists over favorites re-run.
 */
export const reloadFavorites = (): void => {
  void currentFavoriteIds()
    .then((shown) => {
      favorites.update((state) => ({
        ...state,
        ids: shown,
        loaded: true,
        edits: state.edits + 1,
        saved: state.saved + 1,
      }));
      publishLibraryChange({ kind: "favorites" });
    })
    .catch(() => {});
};

/**
 * Pending favorites (a star means downloaded, docs/spec.md): starred YT
 * Music songs this phone has no file for yet, by video, held in memory so
 * their stars flip at once everywhere (Now Playing, menus, the selection
 * bar). The store keeps them (`pending_favorites`, this phone only); the
 * save that brings a song in settles its pending favorite into the Library
 * track's star.
 */
interface PendingFavoritesState {
  readonly videos: ReadonlySet<string>;
  readonly loaded: boolean;
  /** Bumped when stars are set, so a read that raced them reads again. */
  readonly edits: number;
}

const pendingFavorites = makeExternalStore<PendingFavoritesState>({
  videos: new Set(),
  loaded: false,
  edits: 0,
});

let readingPending = false;

/** Reads the pending favorites from the store: at first use, and after a save settled some. */
const readPendingFavorites = (): void => {
  if (readingPending) return;
  readingPending = true;
  const edits = pendingFavorites.get().edits;
  void appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.listPendingFavorites))
    .then((songs) => {
      readingPending = false;
      // A star set while reading may not be in the result; read again.
      if (pendingFavorites.get().edits !== edits) return readPendingFavorites();
      pendingFavorites.update((state) => ({
        ...state,
        videos: new Set(songs.map((song) => song.videoId)),
        loaded: true,
      }));
    })
    .catch(() => {
      readingPending = false;
    });
};

const loadPendingFavorites = (): void => {
  if (!pendingFavorites.get().loaded) readPendingFavorites();
};

/**
 * Stars ([on]) YT Music [songs] as pending favorites, or unstars them: their
 * stars flip at once, and the store keeps them until their files arrive.
 * Should the write fail, the stars go back to what the store holds. Their
 * downloads are `starSongs`'s.
 */
export const setPendingFavorites = (
  songs: readonly PendingFavorite[],
  on: boolean,
): Promise<void> => {
  if (songs.length === 0) return Promise.resolve();
  const videoIds = songs.map((song) => song.videoId);
  for (const id of videoIds) knownPending.set(id, on);
  pendingFavorites.update((state) => {
    const videos = new Set(state.videos);
    for (const id of videoIds) {
      if (on) videos.add(id);
      else videos.delete(id);
    }
    return { ...state, videos, edits: state.edits + 1 };
  });
  return (
    appRuntime
      .runPromise(
        // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
        LibraryStore.use((store) =>
          on ? store.addPendingFavorites(songs) : store.removePendingFavorites(videoIds),
        ),
      )
      // The store holds what was asked; on failure, its stars as they are show again.
      .catch(readPendingFavorites)
  );
};

const pendingVideosNow = (): ReadonlySet<string> => pendingFavorites.get().videos;

const useLoadedPendingFavorites = (active: boolean): void => {
  useEffect(() => {
    if (active) loadPendingFavorites();
  }, [active]);
};

/**
 * The videos of every pending favorite (for marking YT Music songs starred in
 * a list). A screen out of sight doesn't follow them (`useSightedStore`).
 */
export const usePendingFavoriteVideos = (active = true): ReadonlySet<string> => {
  useLoadedPendingFavorites(active);
  return useSightedStore(pendingFavorites.subscribe, pendingVideosNow);
};

/** `usePendingFavoriteVideos` followed whether or not a screen is in sight: for menus and Now Playing. */
export const useLivePendingFavoriteVideos = (active = true): ReadonlySet<string> => {
  useLoadedPendingFavorites(active);
  return useSyncExternalStore(pendingFavorites.subscribe, pendingVideosNow);
};

/**
 * Whether YT Music song [videoId] shows starred (Core's `ytSongStarred`): its pending favorite,
 * or [track]'s star, the Library song it is by now. The one rule for every star a YT Music
 * song shows (Now Playing, its menu).
 */
export const useYtSongStarred = (videoId: string | null, track: { id: number } | null): boolean => {
  const favoriteIds = useLiveFavoriteIds();
  const pending = useLivePendingFavoriteVideos();
  return videoId !== null && ytSongStarred(videoId, track, favoriteIds, pending);
};

/** `useYtSongStarred` as the stores hold it now, unfollowed (`favoriteIdsNow`). */
export const ytSongStarredNow = (videoId: string, track: { id: number } | null): boolean =>
  ytSongStarred(videoId, track, favorites.get().ids, pendingFavorites.get().videos);

// A download or scan that brought in a pending favorite starred it as it saved the song.
onSavedStars(() => {
  reloadFavorites();
  readPendingFavorites();
});

/** Calls [listener] whenever a star has been saved; returns how to stop. */
export const onFavoritesSaved = (listener: () => void): (() => void) => {
  let saved = favorites.get().saved;
  return favorites.subscribe(() => {
    if (favorites.get().saved === saved) return;
    saved = favorites.get().saved;
    listener();
  });
};

/** The scoped Now Playing star follows optimistic edits without loading global lists. */
const subscribeSongStars = subscribeAll(favorites, pendingFavorites);
export const scopedSongStarredNow = (
  id: number | null,
  video: string | null,
  saved: { readonly favorite: boolean; readonly pendingFavorite: boolean },
): boolean => {
  const favorite =
    id === null
      ? false
      : (writing.get(id)?.shown ??
        (favorites.get().loaded ? favorites.get().ids.has(id) : knownStars.get(id)) ??
        saved.favorite);
  const pending =
    video === null
      ? false
      : ((pendingFavorites.get().loaded
          ? pendingFavorites.get().videos.has(video)
          : knownPending.get(video)) ?? saved.pendingFavorite);
  return favorite || pending;
};
export const useScopedSongStarred = (
  id: number | null,
  video: string | null,
  saved: { readonly favorite: boolean; readonly pendingFavorite: boolean },
): boolean =>
  useSyncExternalStore(subscribeSongStars, () => scopedSongStarredNow(id, video, saved));

/** Seed just this track before a cold gesture, so a failed write restores its true star. */
export const rememberSongFavorite = (id: number, favorite: boolean): void => {
  if (favorites.get().loaded || knownStars.has(id) || writing.has(id)) return;
  const ids = new Set(favorites.get().ids);
  if (favorite) ids.add(id);
  else ids.delete(id);
  favorites.set({ ...favorites.get(), ids });
};
