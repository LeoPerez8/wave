import { currentEntry, type QueueState } from "@wave/core";
import { useSyncExternalStore } from "react";

import { playbackState, type PlaybackState } from "./Player";
import { queueState } from "./Queue";

export const usePlayback = (): PlaybackState =>
  useSyncExternalStore(playbackState.subscribe, playbackState.get);

export const useQueue = (): QueueState =>
  useSyncExternalStore(queueState.subscribe, queueState.get);

/** The track id of the current queue entry, if any (for highlighting the playing row). */
export const useCurrentTrackId = (): string | null =>
  useSyncExternalStore(queueState.subscribe, () => currentEntry(queueState.get())?.trackId ?? null);
