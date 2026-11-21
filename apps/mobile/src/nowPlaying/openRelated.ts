import { openNowPlaying } from "./sheet";

const listeners = new Set<() => void>();

/**
 * Opens Now Playing on its Related screen: the chevron beside the player's
 * title, and the playing song's card's Related entry (Now Playing's ⋯ or the
 * mini player's long press). Closed, the sheet shows Related first, so it
 * rises already on it; already open, Related's panel rises over it.
 */
export const openRelated = (): void => {
  for (const listener of listeners) listener();
  openNowPlaying();
};

/** Calls `listener` whenever `openRelated` asks for Related; returns the unsubscribe. */
export const onRelatedOpened = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
