import { discoverMixesDue, type DiscoverMixes } from "./discoverMixes.ts";
import type { MixRowId } from "./homeSections.ts";

/** The daily build takes every due row together; saved mixes stay until it succeeds. */
export const homeMixBuildsDue = (
  rows: readonly {
    readonly id: MixRowId;
    readonly saved: Pick<DiscoverMixes, "builtAt" | "playSeeds"> | null;
    readonly building: boolean;
    readonly retryAt: number | null;
  }[],
  at: { readonly now: number; readonly played: boolean },
): MixRowId[] =>
  rows
    .filter(
      (row) =>
        !row.building &&
        (row.retryAt === null || at.now >= row.retryAt) &&
        discoverMixesDue(row.saved, at),
    )
    .map((row) => row.id);
