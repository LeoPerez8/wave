/**
 * One harvest run (docs/spec.md, "Discover", harvest): it reads the seed
 * Core says to read next (`harvestNext`), one after another, counting what
 * each read used of mobile data, until Core says nothing is left. Kept free
 * of Expo so it runs under plain Node tests; the app's harvest is
 * `mixHarvest.ts`.
 */
import { harvestNext, type HarvestWant } from "@wave/core";
import * as Effect from "effect/Effect";

/** What one seed's read came to. */
export interface HarvestRead {
  /** The bytes it used. */
  readonly bytes: number;
  /**
   * Whether it reached YouTube Music (its meter counted a request). One that
   * didn't (offline) isn't held back for 12 hours: the next run tries it again.
   */
  readonly reached: boolean;
}

/** What a run reads and counts with. */
export interface HarvestRunDeps<S extends { readonly id: string }, R> {
  /** Every seed the run may read, with its candidates and when it was last read (`harvestWants`). */
  readonly wants: readonly (HarvestWant & { readonly seed: S })[];
  /** Whether the phone is on mobile data, read once for the run. */
  readonly onMobileData: boolean;
  /** The mobile data the harvest used today before the run, in bytes. */
  readonly usedToday: number;
  readonly now: () => number;
  /** When each seed was last tried this session, by id: the run adds those whose read reached YouTube Music. */
  readonly tried: Map<string, number>;
  /** Reads [seed]'s radios into the catalog; gives what the read came to. Never fails. */
  readonly read: (seed: S) => Effect.Effect<HarvestRead, never, R>;
  /** Counts [bytes] of mobile data used (only called on mobile data). */
  readonly usedOnMobile: (bytes: number) => void;
}

/** Runs a harvest over [deps]' wants; gives how many seeds it read. */
export const harvestRun = <S extends { readonly id: string }, R>(
  deps: HarvestRunDeps<S, R>,
): Effect.Effect<number, never, R> =>
  Effect.gen(function* () {
    const { wants, onMobileData, now, tried } = deps;
    let usedToday = deps.usedToday;
    let read = 0;
    // This run's reads, those that never reached YouTube Music too: none is read twice in a run.
    const runTried = new Map(tried);
    for (;;) {
      const next = harvestNext(wants, {
        onMobileData,
        usedToday,
        now: now(),
        read,
        tried: runTried,
      });
      if (next === null) return read;
      const at = now();
      runTried.set(next.id, at);
      const { bytes, reached } = yield* deps.read(next.seed);
      if (reached) tried.set(next.id, at);
      read += 1;
      if (onMobileData) {
        usedToday += bytes;
        deps.usedOnMobile(bytes);
      }
    }
  });
