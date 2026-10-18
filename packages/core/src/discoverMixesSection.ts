/**
 * What Home's Discover mixes section shows (docs/spec.md, "Discover mixes"):
 * the mixes last built, as the owner's level blends them, a skeleton of
 * their row while none are saved yet, or nothing.
 */

import { MIX_FEWEST, type DiscoverMixes } from "./discoverMixes.ts";
import {
  blendDiscoverMix,
  type BlendedDiscoverMix,
  type DiscoverMixBlend,
} from "./discoverMixLevels.ts";

/** What the section draws. */
export type DiscoverMixesSection =
  | { readonly kind: "hidden" }
  /** Placeholder tiles in the mixes' row: the first mixes are on their way. */
  | { readonly kind: "skeleton" }
  | {
      readonly kind: "mixes";
      readonly mixes: readonly BlendedDiscoverMix[];
      /**
       * A rebuild is running: the header says "Updating…" over the saved
       * mixes, which stay until the new ones are saved.
       */
      readonly updating: boolean;
    };

/**
 * What the section shows for the [saved] mixes (`parseDiscoverMixes`, null
 * for none). While YT Music is off ([ytMusic] false), nothing. With mixes
 * saved, those, each blended by [blend] (`blendDiscoverMix`): a rebuild keeps
 * them until new ones are saved; a mix that blends to fewer than ten songs
 * (Don't play explicit leaving most out) isn't shown, and with none left,
 * nothing is. With none saved, a skeleton while a build can make them, a
 * failed build included (a later one may succeed); nothing when the last
 * build found [nothingToBuildFrom] (no plays and an empty Library). While a
 * build is [building], saved mixes say they're updating (no skeleton over
 * them); with none saved, the skeleton stands for it.
 */
export const discoverMixesSection = (
  saved: DiscoverMixes | null,
  {
    ytMusic,
    nothingToBuildFrom,
    blend,
    building = false,
  }: {
    readonly ytMusic: boolean;
    readonly nothingToBuildFrom: boolean;
    readonly blend: DiscoverMixBlend;
    /** A build of the section's mixes is running; absent for none. */
    readonly building?: boolean;
  },
): DiscoverMixesSection => {
  if (!ytMusic) return { kind: "hidden" };
  if (saved !== null) {
    const mixes = saved.mixes.map((mix) => blendDiscoverMix(mix, blend)).filter(isMix);
    return mixes.length === 0 ? { kind: "hidden" } : { kind: "mixes", mixes, updating: building };
  }
  return nothingToBuildFrom ? { kind: "hidden" } : { kind: "skeleton" };
};

/** Whether a blended mix still has enough songs to be one. */
const isMix = (mix: BlendedDiscoverMix): boolean => mix.songs.length >= MIX_FEWEST;

/**
 * The saved mix [id] as [blend] makes it (its page and its menu), or null
 * when none of [saved] has that id or it blends to fewer than ten songs, as
 * Home leaves it out then.
 */
export const savedDiscoverMix = (
  saved: DiscoverMixes | null,
  id: string,
  blend: DiscoverMixBlend,
): BlendedDiscoverMix | null => {
  const mix = saved?.mixes.find((candidate) => candidate.id === id);
  if (mix === undefined) return null;
  const blended = blendDiscoverMix(mix, blend);
  return isMix(blended) ? blended : null;
};
