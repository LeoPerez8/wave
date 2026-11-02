import {
  PLAYLIST_SONG_SORT_BUCKETS,
  readPlaylistSongSort,
  readPlaylistSongSorts,
  storedPlaylistSongSort,
  storedSyncedBucket,
  syncedBucket,
  withSyncedBucketEntry,
  type PlaylistSongSort,
} from "@wave/core";

import { useMemo, useSyncExternalStore } from "react";

import { persistedSetting } from "@/lib/persistedSetting";

const listeners = new Set<() => void>();

/** Calls [listener] whenever a playlist's sort changes, here or from another phone. */
export const onPlaylistSongSortChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Every playlist's song sort, by playlist sync id, in a fixed few synced preferences (Core's
 * `syncedBucket`): however many playlists there are, they take `PLAYLIST_SONG_SORT_BUCKETS`
 * of the account's preferences. Custom stores nothing.
 */
const buckets = Array.from({ length: PLAYLIST_SONG_SORT_BUCKETS }, (_, bucket) =>
  persistedSetting<Readonly<Record<string, string>>>({
    key: `settings.playlistSongs.${bucket}`,
    synced: true,
    read: readPlaylistSongSorts,
    write: storedSyncedBucket,
    onValue: () => {
      for (const listener of listeners) listener();
    },
  }),
);

const bucketOf = (id: string) => buckets[syncedBucket(id, PLAYLIST_SONG_SORT_BUCKETS)]!;

/**
 * The song sort of the playlist with sync id [id]. Setting one gives false when the Wave
 * account couldn't keep it (Core's `withSyncedBucketEntry`; the account's every playlist fits).
 */
export const playlistSongSetting = (id: string) => ({
  get: (): PlaylistSongSort => readPlaylistSongSort(bucketOf(id).get()[id]),
  set: (sort: PlaylistSongSort): boolean => {
    const bucket = bucketOf(id);
    const next = withSyncedBucketEntry(bucket.get(), id, storedPlaylistSongSort(sort));
    if (next === null) return false;
    bucket.set(next);
    return true;
  },
});

/** The song sort of the playlist with sync id [id]; re-renders when it changes, here or elsewhere. */
export const usePlaylistSongSort = (id: string): PlaylistSongSort => {
  const bucket = bucketOf(id);
  const read = () => bucket.get()[id];
  const stored = useSyncExternalStore(bucket.subscribe, read, read);
  return useMemo(() => readPlaylistSongSort(stored), [stored]);
};
