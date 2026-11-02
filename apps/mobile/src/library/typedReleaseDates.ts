import {
  TYPED_RELEASE_BUCKETS,
  readTypedReleaseDates,
  typedReleaseBucket,
  withTypedReleaseDate,
} from "@wave/core";
import { useSyncExternalStore } from "react";

import { persistedSetting } from "@/lib/persistedSetting";

const listeners = new Set<() => void>();
let merged: Readonly<Record<string, string>> | null = null;

/**
 * The release dates the owner typed, by song key (`releaseSongKey`), for Library, YT Music and
 * unsearched songs alike: a few synced preferences (Core's `typedReleaseBucket`), so they reach
 * the owner's other phones, where they win over every date too.
 */
const buckets = Array.from({ length: TYPED_RELEASE_BUCKETS }, (_, bucket) =>
  persistedSetting<Readonly<Record<string, string>>>({
    key: `releaseDates.typed.${bucket}`,
    synced: true,
    read: readTypedReleaseDates,
    write: (dates) => (Object.keys(dates).length === 0 ? null : JSON.stringify(dates)),
    onValue: () => {
      merged = null;
      for (const listener of listeners) listener();
    },
  }),
);

const subscribe = (listener: () => void): (() => void) => {
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
  useValue: (): Readonly<Record<string, string>> => useSyncExternalStore(subscribe, get, get),
};

/**
 * Keeps [date] as the song [key]'s typed date, or clears it (null). False when the Wave
 * account couldn't keep one more (Core's `withTypedReleaseDate`).
 */
export const setTypedReleaseDate = (key: string, date: string | null): boolean => {
  const bucket = buckets[typedReleaseBucket(key)];
  if (bucket === undefined) return false;
  const next = withTypedReleaseDate(bucket.get(), key, date);
  if (next === null) return false;
  bucket.set(next);
  return true;
};
