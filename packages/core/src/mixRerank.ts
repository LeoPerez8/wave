/**
 * A section's sliders moved (docs/spec.md, "Artist mixes"): its saved mixes
 * are ranked again from cached radio pages at once, offline, with no new
 * seed picked. Core says what the re-rank starts from (the build's seeds,
 * avoided songs and variety) and what it saves; the reads are
 * shared ranking's.
 */

import {
  type DiscoverMix,
  type DiscoverMixSeed,
  type DiscoverMixes,
  type DiscoverSeedArtist,
} from "./discoverMixes.ts";
import { identityKey } from "./library.ts";

/** What a re-rank of saved mixes starts from. */
export interface DiscoverMixesRerun {
  /** The build's seeds, in their order. */
  readonly seeds: readonly DiscoverMixSeed[];
  /** The new songs its refresh avoided (go last again). */
  readonly avoid: ReadonlySet<string>;
  /** Legacy saved variety; retained when reranking older mixes. */
  readonly variety?: number;
}

/** The seed [mix] was built from, as far as the mix tells it, its artists found among [artists]. */
const seedOfMix = (mix: DiscoverMix, artists: readonly DiscoverSeedArtist[]): DiscoverMixSeed => {
  const { kind, name, genre } = mix.seed;
  const base = { kind, id: mix.id, name, from: "plays" as const };
  if (kind !== "genre" || genre === undefined) return base;
  const byKey = new Map(artists.map((artist) => [identityKey(artist.name), artist]));
  return {
    ...base,
    genre,
    artists: (mix.seed.artists ?? []).flatMap((artist) => byKey.get(identityKey(artist)) ?? []),
  };
};

/**
 * What re-ranking [saved] starts from: the build's seeds, every one (those
 * that made no mix too), the new songs its refresh avoided and its variety.
 * Mixes saved before builds kept their start have their mixes' seeds (a
 * genre mix's artists found among the Library's [artists], by name), no
 * avoided song and no variety.
 */
export const discoverMixesRerun = (
  saved: DiscoverMixes,
  artists: readonly DiscoverSeedArtist[],
): DiscoverMixesRerun => {
  const { build } = saved;
  if (build === undefined)
    return { seeds: saved.mixes.map((mix) => seedOfMix(mix, artists)), avoid: new Set() };
  return {
    seeds: build.seeds,
    avoid: new Set(build.avoid),
    ...(build.variety === undefined ? {} : { variety: build.variety }),
  };
};

/**
 * What a re-rank of [saved] that made [mixes] saves: the same build (its
 * time, what it started from), with the new mixes; [saved] as it is when it
 * made none, as a build that makes none keeps what was saved.
 */
export const rerankedDiscoverMixes = (
  saved: DiscoverMixes,
  mixes: readonly DiscoverMix[],
): DiscoverMixes => (mixes.length === 0 ? saved : { ...saved, mixes });
