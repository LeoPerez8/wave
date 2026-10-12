import { currentEntry, type QueueContext, type QueueState } from "@wave/core";
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { SongRow } from "@/library/LibraryStore";

import { playSongs } from "./actions";
import { playbackState, type PlaybackState } from "./Player";
import { queueState } from "./Queue";

export const usePlayback = (): PlaybackState =>
  useSyncExternalStore(playbackState.subscribe, playbackState.get);

/** Whether the player is playing (or about to, once buffered); position ticks don't re-render. */
export const usePlayWhenReady = (): boolean =>
  useSyncExternalStore(playbackState.subscribe, () => playbackState.get().playWhenReady);

export const useQueue = (): QueueState =>
  useSyncExternalStore(queueState.subscribe, queueState.get);

/** The track id of the current queue entry, if any (for highlighting the playing row). */
export const useCurrentTrackId = (): string | null =>
  useSyncExternalStore(queueState.subscribe, () => currentEntry(queueState.get())?.trackId ?? null);

/**
 * Play / Shuffle for a screen's songs, which may still be loading (a screen
 * shows its header before its query is done): pressed before they're read
 * ([songs] undefined), it plays them as soon as they are.
 */
export const usePlaySongs = (
  songs: readonly SongRow[] | undefined,
  context: QueueContext,
): ((shuffle: boolean) => void) => {
  /** The press waiting for the songs: shuffle or not; null for none. */
  const pending = useRef<boolean | null>(null);
  useEffect(() => {
    const shuffle = pending.current;
    if (songs === undefined || shuffle === null) return;
    pending.current = null;
    if (songs.length > 0) playSongs(songs, undefined, context, { shuffle });
  }, [songs, context]);
  return (shuffle) => {
    if (songs === undefined) pending.current = shuffle;
    else playSongs(songs, undefined, context, { shuffle });
  };
};
