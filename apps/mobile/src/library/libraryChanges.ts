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

const unstarredListeners = new Set<(trackIds: readonly string[]) => void>();

/**
 * Tells what follows stars (the taste profile) that the owner unstarred
 * [trackIds] (queue track ids: the Library's and YT Music songs').
 */
export const publishUnstarred = (trackIds: readonly string[]): void => {
  if (trackIds.length === 0) return;
  for (const listener of unstarredListeners) listener(trackIds);
};

/** Calls [listener] with the tracks each unstar by the owner unstarred (`publishUnstarred`); returns how to stop. */
export const onUnstarred = (listener: (trackIds: readonly string[]) => void): (() => void) => {
  unstarredListeners.add(listener);
  return () => {
    unstarredListeners.delete(listener);
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

/** What the owner did to YT Music songs that a Magic Queue learns from. */
export type YtSongSignal = "favorite" | "download";

const ytSignalListeners = new Set<(kind: YtSongSignal, videoIds: readonly string[]) => void>();

/** Tells what follows YT Music songs (the Magic Queue) that the owner starred or downloaded [videoIds]. */
export const publishYtSongSignal = (kind: YtSongSignal, videoIds: readonly string[]): void => {
  if (videoIds.length === 0) return;
  for (const listener of ytSignalListeners) listener(kind, videoIds);
};

/** Calls [listener] with each YT Music star or download by the owner (`publishYtSongSignal`); returns how to stop. */
export const onYtSongSignal = (
  listener: (kind: YtSongSignal, videoIds: readonly string[]) => void,
): (() => void) => {
  ytSignalListeners.add(listener);
  return () => {
    ytSignalListeners.delete(listener);
  };
};

/** Saved recording metadata, announced after the download transaction commits. */
const downloadedRecordingListeners = new Set<(song: import("@wave/core").LibrarySongKey) => void>();

export const publishDownloadedRecording = (song: import("@wave/core").LibrarySongKey): void => {
  for (const listener of downloadedRecordingListeners) listener(song);
};

/** One shared playing-song subscriber, independent of how many list consumers are mounted. */
export const onDownloadedRecording = (
  listener: (song: import("@wave/core").LibrarySongKey) => void,
): (() => void) => {
  downloadedRecordingListeners.add(listener);
  return () => {
    downloadedRecordingListeners.delete(listener);
  };
};
