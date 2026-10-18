import type { LibraryChange } from "@wave/core";

/**
 * What changed in the Library, as every write announces it (Core's
 * `LibraryChange`: a kind, the ids when the writer knows them, and whether it
 * is one of a burst). Shared Library queries (`useLibraryQuery`) follow it to
 * re-read only what a change reaches.
 *
 * The version stores (`libraryVersion`, `playlistsVersion`, the favorites'
 * `saved`, `playHistoryVersion`) are still bumped alongside, for what follows
 * them directly (the Search index, sync, downloads).
 */
const listeners = new Set<(change: LibraryChange) => void>();

/** Tells everything following the Library that [change] happened. */
export const publishLibraryChange = (change: LibraryChange): void => {
  for (const listener of listeners) listener(change);
};

/** Calls [listener] with every Library change; returns how to stop. */
export const onLibraryChange = (listener: (change: LibraryChange) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const starredListeners = new Set<(trackIds: readonly number[]) => void>();

/** Tells what follows stars (the Magic Queue) that the owner starred [trackIds]. */
export const publishStarred = (trackIds: readonly number[]): void => {
  if (trackIds.length === 0) return;
  for (const listener of starredListeners) listener(trackIds);
};

/** Calls [listener] with the tracks each star by the owner starred (`publishStarred`); returns how to stop. */
export const onStarred = (listener: (trackIds: readonly number[]) => void): (() => void) => {
  starredListeners.add(listener);
  return () => {
    starredListeners.delete(listener);
  };
};

const starListeners = new Set<(trackIds: readonly number[]) => void>();

/**
 * Tells the favorites that a save starred [trackIds] itself: pending
 * favorites a download or scan settled (`SavedBatch.starred`). Kept here,
 * free of the runtime, so the scan and downloads can say it.
 */
export const publishSavedStars = (trackIds: readonly number[]): void => {
  if (trackIds.length === 0) return;
  for (const listener of starListeners) listener(trackIds);
};

/** Calls [listener] with the tracks each save starred (`publishSavedStars`); returns how to stop. */
export const onSavedStars = (listener: (trackIds: readonly number[]) => void): (() => void) => {
  starListeners.add(listener);
  return () => {
    starListeners.delete(listener);
  };
};
