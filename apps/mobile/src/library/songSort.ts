import { readSongSort, writeSongSort, type SongSort } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/** The kinds of song list that remember a sort; every list of a kind shares it. */
export type SongListKind = "songs";

const storageKey = (kind: SongListKind): string => `settings.songSort.${kind}`;

const current = new Map<SongListKind, SongSort>();
const listeners = new Set<() => void>();

/** The sort [kind] lists use, for code outside React. */
export const currentSongSort = (kind: SongListKind): SongSort => {
  let sort = current.get(kind);
  if (sort === undefined) {
    sort = readSongSort(Storage.getItemSync(storageKey(kind)));
    current.set(kind, sort);
  }
  return sort;
};

/** Sorts every [kind] list by [sort] from now on, across restarts. */
export const setSongSort = (kind: SongListKind, sort: SongSort): void => {
  const was = currentSongSort(kind);
  if (was.key === sort.key && was.descending === sort.descending) return;
  current.set(kind, sort);
  Storage.setItemSync(storageKey(kind), writeSongSort(sort));
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The sort [kind] lists use (Song name A to Z until changed); re-renders when it changes. */
export const useSongSort = (kind: SongListKind): SongSort =>
  useSyncExternalStore(subscribe, () => currentSongSort(kind));
