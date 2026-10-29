import { discoverMixesDue, type DiscoverMixes } from "./discoverMixes.ts";
import { discoverMixRowsToBuild, type DiscoverRowId, type MixRowId } from "./homeSections.ts";

/** The daily build takes every due row together; saved mixes stay until it succeeds. */
export const homeMixBuildsDue = (
  rows: readonly {
    readonly id: MixRowId;
    readonly saved: Pick<DiscoverMixes, "builtAt" | "playSeeds" | "build"> | null;
    readonly building: boolean;
    readonly retryAt: number | null;
  }[],
  at: {
    readonly now: number;
    readonly played: boolean;
    readonly librarySeeds?: boolean;
    readonly discover?: { readonly rows: readonly DiscoverRowId[]; readonly empty: boolean };
  },
): MixRowId[] =>
  rows
    .filter(
      (row) =>
        (at.discover === undefined ||
          discoverMixRowsToBuild(at.discover.rows, at.discover).includes(row.id)) &&
        !row.building &&
        (row.retryAt === null || at.now >= row.retryAt) &&
        discoverMixesDue(row.saved, at),
    )
    .map((row) => row.id);
