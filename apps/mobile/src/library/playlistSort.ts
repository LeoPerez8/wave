import {
  PLAYLIST_SORTS,
  choosePlaylistSort,
  sortPlaylists,
  type PlaylistOrder,
  type PlaylistSort,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo } from "react";

import { currentLocalisation } from "@/localisation/localisation";
import type { ChoiceSetting } from "@/settings/ChoiceRow";

import { usePlaylists } from "./hooks";
import { LibraryStore, type PlaylistRow } from "./LibraryStore";
import { NEVER_PLAYED, playlistOrder } from "./playlistOrder";
import { knownPlaylists } from "./playlists";
import { appRuntime } from "./runtime";
import { libraryQuery, useLibraryQuery } from "./sharedQueries";

/** How the Playlists list is sorted (by name until changed); re-renders when it changes. */
export const usePlaylistSort = (): PlaylistSort => playlistOrder.useValue().sort;

/** Re-read after plays, which move playlists under Recently Played, and playlist edits. */
const readLastPlayed = libraryQuery(
  "playlistsLastPlayed",
  { playlists: true, plays: true },
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* store.playlistsLastPlayed;
  }),
);

/**
 * Every playlist in the order the owner picked, both Playlists lists alike:
 * re-sorted at once when the sort or the custom order changes, and after
 * plays under Recently Played.
 */
export const useSortedPlaylists = (): readonly PlaylistRow[] => {
  const playlists = usePlaylists();
  const { sort, order } = playlistOrder.useValue();
  const lastPlayed = useLibraryQuery(sort === "played" ? readLastPlayed : null, NEVER_PLAYED);
  return useMemo(
    () => sortPlaylists(playlists, { sort, order, lastPlayed }),
    [playlists, sort, order, lastPlayed],
  );
};

/**
 * The order once the owner picks [sort] (Core's `choosePlaylistSort`): read
 * from the playlists as the current sort orders them, whether or not a
 * Playlists list is showing.
 */
const choosing = (sort: PlaylistSort) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const playlists = knownPlaylists() ?? (yield* store.listPlaylists);
    const current = playlistOrder.get();
    const lastPlayed = current.sort === "played" ? yield* store.playlistsLastPlayed : NEVER_PLAYED;
    return choosePlaylistSort({ ...current, lastPlayed }, sort, playlists);
  });

/** Counts picks, so only the latest one lands. */
let picks = 0;

/**
 * Sorts the Playlists list by [sort]: everywhere at once, kept across
 * restarts. Custom brings back the order arranged before, or starts from the
 * order the sort showed.
 */
const pickPlaylistSort = (sort: PlaylistSort): void => {
  const pick = ++picks;
  const land = (chosen: PlaylistOrder) => {
    if (pick === picks) playlistOrder.set(chosen);
  };
  // Unread, the playlists the list already holds stand in.
  const unread = () =>
    land(
      choosePlaylistSort(
        { ...playlistOrder.get(), lastPlayed: NEVER_PLAYED },
        sort,
        knownPlaylists() ?? [],
      ),
    );
  void appRuntime.runPromise(choosing(sort)).then(land, unread);
};

/**
 * The sorts under Sort by, offered by the Playlists title's long press (under
 * the layouts) and by Settings › Layout › Playlists alike. Picking one runs
 * `pickPlaylistSort`.
 */
export const playlistSortChoice: ChoiceSetting<PlaylistSort> = {
  // Read when shown, so they're in the language Wave reads in.
  get label() {
    return currentLocalisation().strings.playlists.sortBy;
  },
  get choices() {
    const { sorts } = currentLocalisation().strings.playlists;
    return PLAYLIST_SORTS.map(({ sort }) => ({ value: sort, label: sorts[sort] }));
  },
  setting: {
    get: () => playlistOrder.get().sort,
    set: pickPlaylistSort,
    useValue: usePlaylistSort,
  },
};
