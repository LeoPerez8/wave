import {
  TYPED_RELEASE_BUCKETS,
  readTypedReleaseDates,
  storedSyncedBucket,
  syncedBucket,
  typedReleaseEntry,
  typedReleaseKey,
  withSyncedBucketEntry,
  type ReleaseKeySong,
} from "@wave/core";
import { useSyncExternalStore } from "react";

import { persistedSetting } from "@/lib/persistedSetting";

const listeners = new Set<() => void>();
let merged: Readonly<Record<string, string>> | null = null;

/**
 * The release dates the owner typed, by song key (Core's `typedReleaseKey`), for Library, YT
 * Music and unsearched songs alike: a few synced preferences (Core's `syncedBucket`), so they
 * reach the owner's other phones, where they win over every date too.
 */
const buckets = Array.from({ length: TYPED_RELEASE_BUCKETS }, (_, bucket) =>
  persistedSetting<Readonly<Record<string, string>>>({
    key: `releaseDates.typed.${bucket}`,
    synced: true,
    read: readTypedReleaseDates,
    write: storedSyncedBucket,
    onValue: () => {
      merged = null;
      for (const listener of listeners) listener();
    },
  }),
);

/** Calls [listener] whenever a typed date changes, here or from another phone; gives its stop. */
export const onTypedReleaseDatesChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Every typed date, by song key. */
const get = (): Readonly<Record<string, string>> =>
  (merged ??= Object.assign({}, ...buckets.map((bucket) => bucket.get())));

export const typedReleaseDates = {
  get,
  /** Every typed date, by song key; re-renders when one changes, here or from another phone. */
  useValue: (): Readonly<Record<string, string>> =>
    useSyncExternalStore(onTypedReleaseDatesChanged, get, get),
};

/**
 * Keeps [date] as the date the owner typed for [song], or clears the one it has (null, Core's
 * `typedReleaseEntry`). False when the Wave account couldn't keep one more (Core's
 * `withSyncedBucketEntry`).
 */
export const setTypedReleaseDate = (song: ReleaseKeySong, date: string | null): boolean => {
  const key = date === null ? typedReleaseEntry(get(), song)?.key : typedReleaseKey(song);
  if (key === undefined) return true;
  const bucket = buckets[syncedBucket(key, TYPED_RELEASE_BUCKETS)];
  if (bucket === undefined) return false;
  const next = withSyncedBucketEntry(bucket.get(), key, date);
  if (next === null) return false;
  bucket.set(next);
  return true;
};
