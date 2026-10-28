import {
  readSongSort,
  sameSongSort,
  sortSongs,
  writeSongSort,
  type SongListKind,
  type LibrarySongSort,
  type SongSort,
  type SortableSong,
} from "@wave/core";
import { useMemo } from "react";

import { persistedSetting, type PersistedSetting } from "@/lib/persistedSetting";

const settings = new Map<SongListKind, PersistedSetting<SongSort>>();

/** Each kind's sort, saved under its own key. */
const setting = (kind: SongListKind): PersistedSetting<SongSort> => {
  let found = settings.get(kind);
  if (found === undefined) {
    found = persistedSetting({
      key: `settings.songSort.${kind}`,
      read: (stored) => readSongSort(stored, kind),
      write: writeSongSort,
      equals: sameSongSort,
    });
    settings.set(kind, found);
  }
  return found;
};

/** [songs] in the sort [kind] lists use, for code outside React. */
export const sortedForKind = <S extends SortableSong>(
  kind: SongListKind,
  songs: readonly S[],
): S[] => sortSongs(songs, setting(kind).get());

/** Sorts every [kind] list by [sort] from now on, across restarts. */
export const setSongSort = (kind: SongListKind, sort: SongSort): void => setting(kind).set(sort);

/** The sort every [kind] list uses (its own order until changed); re-renders when it changes. */
export const useSongSort = (kind: SongListKind): SongSort => setting(kind).useValue();

/**
 * A [kind] list's songs in its chosen sort, re-sorted only when the songs or
 * the sort change; Play, Shuffle and rows all play this displayed order.
 */
export function useSortedSongs<S extends SortableSong>(
  kind: SongListKind,
  songs: readonly S[],
): { readonly sort: SongSort; readonly songs: S[] };
export function useSortedSongs<S extends SortableSong>(
  kind: SongListKind,
  songs: readonly S[] | undefined,
): { readonly sort: SongSort; readonly songs: S[] | undefined };
export function useSortedSongs<S extends SortableSong>(
  kind: SongListKind,
  songs: readonly S[] | undefined,
) {
  const sort = useSongSort(kind);
  const sorted = useMemo(
    () => (songs === undefined ? undefined : sortSongs(songs, sort)),
    [songs, sort],
  );
  return { sort, songs: sorted };
}

/** The Songs tab's saved SQL sort, also used by its Queue section action. */
export const songsSortNow = (): LibrarySongSort => setting("songs").get() as LibrarySongSort;
