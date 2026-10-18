/**
 * What Home's Discover mixes section shows (docs/spec.md, "Discover mixes"):
 * the mixes last built, a skeleton of their row while none are saved yet, or
 * nothing.
 */

import type { DiscoverMix, DiscoverMixes } from "./discoverMixes.ts";

/** What the section draws. */
export type DiscoverMixesSection =
  | { readonly kind: "hidden" }
  /** Placeholder tiles in the mixes' row: the first mixes are on their way. */
  | { readonly kind: "skeleton" }
  | { readonly kind: "mixes"; readonly mixes: readonly DiscoverMix[] };

/**
 * What the section shows for the [saved] mixes (`parseDiscoverMixes`, null
 * for none). While YT Music is off ([ytMusic] false), nothing. With mixes
 * saved, those: a rebuild keeps them until new ones are saved. With none, a
 * skeleton while a build can make them, a failed build included (a later one
 * may succeed); nothing when the last build found [nothingToBuildFrom] (no
 * plays and an empty Library).
 */
export const discoverMixesSection = (
  saved: DiscoverMixes | null,
  {
    ytMusic,
    nothingToBuildFrom,
  }: { readonly ytMusic: boolean; readonly nothingToBuildFrom: boolean },
): DiscoverMixesSection => {
  if (!ytMusic) return { kind: "hidden" };
  if (saved !== null) return { kind: "mixes", mixes: saved.mixes };
  return nothingToBuildFrom ? { kind: "hidden" } : { kind: "skeleton" };
};
