/**
 * How songs landing in the Library during a download run reach Wave's lists
 * (docs/spec.md, YT Music, Downloads): gathered, and announced together as a
 * burst at most every `LANDING_BURST_MS`, as a scan's batches are.
 */
import type { LibraryChange } from "./libraryQueries.ts";

/** Landings are announced together at most this often. */
export const LANDING_BURST_MS = 2000;

export interface Landings {
  /**
   * Tracks [trackIds] landed (an import, a quality replacement, a download's
   * fill-in). [last]: nothing else of the run is on its way, so what's
   * gathered is announced at once rather than waiting for another landing.
   */
  readonly land: (trackIds: readonly number[], options?: { readonly last?: boolean }) => void;
}

/**
 * Gathers landed tracks and announces them as one `tracks` change naming
 * them, a burst (Core's `LibraryChange.burst`): the first landing since the
 * last announcement waits `LANDING_BURST_MS`, and what lands meanwhile joins
 * it. The run's last landing is announced at once.
 */
export const createLandings = (options: {
  /** Calls [run] in [ms]; returns how to cancel it. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  readonly announce: (change: LibraryChange) => void;
}): Landings => {
  const { schedule, announce } = options;
  const gathered = new Set<number>();
  let cancelWait: (() => void) | null = null;

  const flush = (): void => {
    cancelWait?.();
    cancelWait = null;
    if (gathered.size === 0) return;
    const ids = [...gathered];
    gathered.clear();
    announce({ kind: "tracks", ids, burst: true });
  };

  return {
    land: (trackIds, { last = false } = {}) => {
      for (const id of trackIds) gathered.add(id);
      if (last) flush();
      else cancelWait ??= schedule(LANDING_BURST_MS, flush);
    },
  };
};
