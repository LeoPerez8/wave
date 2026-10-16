import { PLAYLIST_SORTS, choosePlaylistSort, sortPlaylists, type PlaylistSort } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";

import type { ChoiceSetting } from "@/settings/ChoiceRow";

import { usePlaylists } from "./hooks";
import { LibraryStore, type PlaylistRow } from "./LibraryStore";
import { NEVER_PLAYED, playlistOrder } from "./playlistOrder";
import { knownPlaylists } from "./playlists";
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

/** The ids in the order the Playlists list last showed them, for picking Custom. */
let shownIds: readonly number[] | undefined;

const idsOf = (playlists: readonly PlaylistRow[]): number[] =>
  playlists.map((playlist) => playlist.id);

/**
 * Every playlist in the order the owner picked, both Playlists lists alike:
 * re-sorted at once when the sort or the custom order changes, and after
 * plays under Recently Played.
 */
export const useSortedPlaylists = (): readonly PlaylistRow[] => {
  const playlists = usePlaylists();
  const { sort, order } = playlistOrder.useValue();
  const lastPlayed = useLibraryQuery(sort === "played" ? readLastPlayed : null, NEVER_PLAYED);
  const sorted = useMemo(
    () => sortPlaylists(playlists, { sort, order, lastPlayed }),
    [playlists, sort, order, lastPlayed],
  );
  useEffect(() => {
    shownIds = idsOf(sorted);
  }, [sorted]);
  return sorted;
};

/**
 * Sorts the Playlists list by [sort]: everywhere at once, kept across
 * restarts. Custom brings back the order arranged before, or starts from the
 * order on screen.
 */
const pickPlaylistSort = (sort: PlaylistSort): void => {
  const current = playlistOrder.get();
  const shown =
    shownIds ??
    idsOf(sortPlaylists(knownPlaylists() ?? [], { ...current, lastPlayed: NEVER_PLAYED }));
  playlistOrder.set(choosePlaylistSort(current, sort, shown));
};

/**
 * The sorts under Sort by, offered by the Playlists title's long press (under
 * the layouts) and by Settings › Layout › Playlists alike. Picking one runs
 * `pickPlaylistSort`.
 */
export const playlistSortChoice: ChoiceSetting<PlaylistSort> = {
  label: "Sort by",
  choices: PLAYLIST_SORTS.map(({ sort, label }) => ({ value: sort, label })),
  setting: {
    get: () => playlistOrder.get().sort,
    set: pickPlaylistSort,
    useValue: usePlaylistSort,
  },
};
