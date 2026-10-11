import { useSyncExternalStore } from "react";

import { playbackState, type PlaybackState } from "./Player";

export const usePlayback = (): PlaybackState =>
  useSyncExternalStore(playbackState.subscribe, playbackState.get);

/** The id of the item loaded in the player, if any. */
export const useCurrentItemId = (): string | null =>
  useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item?.id ?? null);
