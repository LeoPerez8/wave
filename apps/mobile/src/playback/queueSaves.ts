import type { QueueWrite } from "@wave/core";

import type { ExternalStore } from "../lib/externalStore.ts";
import { observePlayCheckpoints } from "./playCheckpoints.ts";

/** How often the position is written while playing; it's also written on pause and on leaving the app. */
const POSITION_SAVE_INTERVAL_MS = 5_000;

export interface QueueSaves {
  /** Saving starts once the restore is over, so an empty queue at startup can't overwrite the saved one. */
  readonly start: () => void;
  /** Saves the position now (Wave is leaving the foreground), once saving started. */
  readonly savePositionNow: () => void;
  readonly stop: () => void;
}

/**
 * Decides when `PlaybackPersistence` writes the queue and its place: each
 * settled change (`settledQueue`) with the position, and the position alone
 * every 5 s while playing and on pause. A timer drives the steady-play saves,
 * so they don't need native position reports. Changes that settle before
 * saving starts aren't lost: the next write carries their parts.
 */
export const observeQueueSaves = (deps: {
  readonly playback: Pick<ExternalStore<{ readonly isPlaying: boolean }>, "get" | "subscribe">;
  readonly settled: Pick<ExternalStore<QueueWrite | null>, "get" | "subscribe">;
  readonly positionMs: () => number;
  readonly saveQueue: (write: QueueWrite) => void;
  readonly savePosition: (positionMs: number) => void;
}): QueueSaves => {
  let saving = false;
  let missed: QueueWrite | null = null;
  let wasPlaying = false;

  const savePositionNow = (): void => {
    if (saving) deps.savePosition(deps.positionMs());
  };

  const stopSettled = deps.settled.subscribe(() => {
    const write = deps.settled.get();
    if (write === null) return;
    // Omitted parts keep their saved value, so the later write's parts win.
    const pending = missed === null ? write : { ...missed, ...write };
    if (!saving) {
      missed = pending;
      return;
    }
    missed = null;
    // The position moved on since the last settle (saved on its own meanwhile): it always goes.
    deps.saveQueue({ ...pending, positionMs: deps.positionMs() });
  });
  const stopPause = deps.playback.subscribe(() => {
    const { isPlaying } = deps.playback.get();
    const paused = wasPlaying && !isPlaying;
    wasPlaying = isPlaying;
    if (paused) savePositionNow();
  });
  const stopCheckpoints = observePlayCheckpoints(
    deps.playback,
    savePositionNow,
    POSITION_SAVE_INTERVAL_MS,
  );

  return {
    start: () => {
      saving = true;
      wasPlaying = deps.playback.get().isPlaying;
    },
    savePositionNow,
    stop: () => {
      stopSettled();
      stopPause();
      stopCheckpoints();
    },
  };
};
