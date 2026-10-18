/**
 * How songs landing in the Library during a download run reach Wave's lists
 * (docs/spec.md, YT Music, Downloads): gathered, and announced together as a
 * burst at most every `LANDING_BURST_MS`, as a scan's batches are; a
 * downloaded song and its fill-in as one change.
 */
import type { LibraryChange } from "./libraryQueries.ts";

/** Landings are announced together at most this often, and a song waits this long at most for its fill-in. */
export const LANDING_BURST_MS = 2000;

export interface Landings {
  /**
   * Tracks [trackIds] landed (an import, a quality replacement). [last]:
   * nothing else of the run is on its way (or the run ended, with no ids), so
   * what's gathered is announced at once rather than waiting for another
   * landing. [fillIn]: their fill-in follows ([filled]), and they wait for it,
   * `LANDING_BURST_MS` at most, so the song and its fill-in are one change.
   */
  readonly land: (
    trackIds: readonly number[],
    options?: { readonly last?: boolean; readonly fillIn?: boolean },
  ) => void;
  /**
   * The fill-in of Tracks [trackIds] is done; [wrote]: it changed them. A song
   * still waiting for it goes with its change; one already announced lands
   * again only when the fill-in wrote something.
   */
  readonly filled: (trackIds: readonly number[], options: { readonly wrote: boolean }) => void;
}

/**
 * Gathers landed tracks and announces them as one `tracks` change naming
 * them, a burst (Core's `LibraryChange.burst`): the first landing since the
 * last announcement waits `LANDING_BURST_MS`, and what lands meanwhile joins
 * it. The run's last landing is announced at once. A song waiting for its
 * fill-in holds the announcement back until the fill-in is done or its
 * `LANDING_BURST_MS` are over, whichever comes first.
 */
export const createLandings = (options: {
  /** Calls [run] in [ms]; returns how to cancel it. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  readonly announce: (change: LibraryChange) => void;
}): Landings => {
  const { schedule, announce } = options;
  const gathered = new Set<number>();
  /** The songs waiting for their fill-in, and how to stop waiting. */
  const held = new Map<number, () => void>();
  let cancelWait: (() => void) | null = null;
  /** The burst's wait is over, or the run ended: announce as soon as nothing is held. */
  let due = false;

  const flushIfDue = (): void => {
    if (!due || held.size > 0) return;
    due = false;
    cancelWait?.();
    cancelWait = null;
    if (gathered.size === 0) return;
    const ids = [...gathered];
    gathered.clear();
    announce({ kind: "tracks", ids, burst: true });
  };

  const release = (trackIds: readonly number[]): void => {
    for (const id of trackIds) {
      held.get(id)?.();
      held.delete(id);
    }
    flushIfDue();
  };

  const land: Landings["land"] = (trackIds, { last = false, fillIn = false } = {}) => {
    for (const id of trackIds) {
      gathered.add(id);
      if (fillIn && !held.has(id))
        held.set(
          id,
          schedule(LANDING_BURST_MS, () => release([id])),
        );
    }
    if (last) {
      due = true;
      flushIfDue();
    } else if (trackIds.length > 0)
      cancelWait ??= schedule(LANDING_BURST_MS, () => {
        cancelWait = null;
        due = true;
        flushIfDue();
      });
  };

  return {
    land,
    filled: (trackIds, { wrote }) => {
      const waiting = trackIds.filter((id) => held.has(id));
      const late = trackIds.filter((id) => !held.has(id));
      release(waiting);
      if (wrote && late.length > 0) land(late);
    },
  };
};
