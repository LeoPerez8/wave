/**
 * Playback restore: picking the queue back up after Wave's process ended. The
 * saved queue may name songs that have since left the library (deleted files,
 * a removed or excluded folder); those entries are left out.
 */

import type { QueueState } from "./queue.ts";

export interface RestoredPlayback {
  readonly state: QueueState;
  /** Where to resume the current entry, paused. */
  readonly positionMs: number;
}

/**
 * Restores [saved] with only the tracks [isAvailable] accepts. The current
 * entry keeps [positionMs]; when its track is gone, the next remaining entry
 * (or else the one before) becomes current from the top. Null when nothing is
 * left to play.
 */
export const restorePlayback = (
  saved: QueueState,
  positionMs: number,
  isAvailable: (trackId: string) => boolean,
): RestoredPlayback | null => {
  const current = saved.entries[saved.index];
  if (current === undefined) return null;
  const entries = saved.entries.filter((entry) => isAvailable(entry.trackId));
  if (entries.length === 0) return null;
  if (isAvailable(current.trackId)) {
    const state =
      entries.length === saved.entries.length
        ? saved
        : { ...saved, entries, index: entries.indexOf(current) };
    return { state, positionMs: Math.max(0, positionMs) };
  }
  const after = saved.entries.slice(saved.index + 1).find((entry) => isAvailable(entry.trackId));
  const index = after === undefined ? entries.length - 1 : entries.indexOf(after);
  return { state: { ...saved, entries, index }, positionMs: 0 };
};
