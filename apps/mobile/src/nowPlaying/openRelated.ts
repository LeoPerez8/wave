import { openNowPlaying } from "./sheet";

const listeners = new Set<() => void>();

/**
 * Opens Now Playing on its Related view: the playing song's card's Related
 * entry (Now Playing's ⋯ or the mini player's long press), even when Related
 * also sits in a bottom-row slot. The sheet shows the view first, so it rises
 * already on it; already open, it switches to it.
 */
export const openRelated = (): void => {
  for (const listener of listeners) listener();
  openNowPlaying();
};

/** Calls `listener` whenever `openRelated` asks for the Related view; returns the unsubscribe. */
export const onRelatedOpened = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
