/**
 * One harvest run (docs/spec.md, "Discover", harvest): it reads the seed
 * Core says to read next (`harvestNext`), one after another, counting what
 * each read used of mobile data, until Core says nothing is left. Kept free
 * of Expo so it runs under plain Node tests; the app's harvest is
 * `mixHarvest.ts`.
 */
import { harvestNext, type HarvestWant } from "@wave/core";
import * as Effect from "effect/Effect";

/** What a run reads and counts with. */
export interface HarvestRunDeps<S extends { readonly id: string }, R> {
  /** Every seed the run may read, with its candidates and when it was last read (`harvestWants`). */
  readonly wants: readonly (HarvestWant & { readonly seed: S })[];
  /** Whether the phone is on mobile data, read once for the run. */
  readonly onMobileData: boolean;
  /** The mobile data the harvest used today before the run, in bytes. */
  readonly usedToday: number;
  readonly now: () => number;
  /** When each seed was last tried this session, by id: the run adds those it reads. */
  readonly tried: Map<string, number>;
  /** Reads [seed]'s radios into the catalog; gives the bytes the read used. Never fails. */
  readonly read: (seed: S) => Effect.Effect<number, never, R>;
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
    for (;;) {
      const next = harvestNext(wants, { onMobileData, usedToday, now: now(), read, tried });
      if (next === null) return read;
      tried.set(next.id, now());
      const bytes = yield* deps.read(next.seed);
      read += 1;
      if (onMobileData) {
        usedToday += bytes;
        deps.usedOnMobile(bytes);
      }
    }
  });
