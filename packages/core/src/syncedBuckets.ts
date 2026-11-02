/**
 * Records kept in a fixed number of synced preferences ("buckets"), for settings with one
 * entry per song or per playlist: however many entries there are, they take the same few of
 * the 200 preferences the Wave account keeps, each value under its 16,384 characters.
 */

import { readStoredRecord } from "./storedJson.ts";

/** The longest value a synced preference may have (the sync service's `MAX_TEXT_LENGTH`). */
export const SYNCED_VALUE_MAX = 16_384;

/** Which of [buckets] preferences holds the entry with [key]: always the same one. */
export const syncedBucket = (key: string, buckets: number): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % buckets;
};

/** One bucket's entries, by key, from what it stores; a value [read] gives null for is left out. */
export const readSyncedBucket = <V>(
  stored: string | null,
  read: (value: unknown) => V | null,
): Record<string, V> => {
  const entries: Record<string, V> = {};
  for (const [key, value] of Object.entries(readStoredRecord(stored))) {
    const entry = read(value);
    if (entry !== null) entries[key] = entry;
  }
  return entries;
};

/**
 * [entries] with [key]'s entry set to [value], or taken out (null). Null when the bucket would
 * grow past `SYNCED_VALUE_MAX`; taking one out always fits.
 */
export const withSyncedBucketEntry = <V>(
  entries: Readonly<Record<string, V>>,
  key: string,
  value: NoInfer<V> | null,
): Record<string, V> | null => {
  const { [key]: _old, ...rest } = entries;
  const next = value === null ? rest : { ...rest, [key]: value };
  return value !== null && JSON.stringify(next).length > SYNCED_VALUE_MAX ? null : next;
};

/** What a bucket stores for [entries]: null (nothing) for none. */
export const storedSyncedBucket = (entries: Readonly<Record<string, unknown>>): string | null =>
  Object.keys(entries).length === 0 ? null : JSON.stringify(entries);
