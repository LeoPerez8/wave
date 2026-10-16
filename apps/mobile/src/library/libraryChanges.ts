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
