import { finishSteps } from "./buildSteps.ts";
/**
 * Home's mixes built from the candidate catalog (docs/spec.md, "Artist
 * mixes", "Genre mixes"): each seed's songs are the engine's ranking of the
 * catalog (`recommend`), in place of a radio read now, and the mixes' rules
 * stay theirs (`discoverMixesOfRadios`: no song the owner knows, none in two
 * of a section's mixes, genre affinity, the familiar share, ten songs at
 * least). So a build is at once and offline; the harvest refills the catalog
 * (`harvest.ts`).
 */

import {
  discoverMixesOfRadiosSteps,
  discoverMixesOfRadios,
  type DiscoverMixRead,
} from "./discoverMixRadios.ts";
import type { DiscoverMixPoolSources } from "./discoverMixLevels.ts";
import {
  mixSeedArtists,
  type DiscoverLibrarySong,
  type DiscoverMix,
  type DiscoverMixSeed,
  type DiscoverRadioSong,
} from "./discoverMixes.ts";
import {
  mixSeedProfileSteps,
  mixSeedStyleSteps,
  mixSeedProfile,
  mixSeedStyle,
  type GenreProfileLibrary,
  type MixAffinity,
} from "./genreAffinity.ts";
import {
  rankRecommendedSteps,
  recommendCandidatesSteps,
  recommend,
  type RecommendCandidate,
  type RecommendedSong,
  type RecommendOptions,
  type RecommendSeed,
  type RecommendSources,
} from "./recommend.ts";
import { seededRandom } from "./weightedPick.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

/** A catalog song as a mix keeps it: a song, never a music video. */
export type CatalogMixSong = YtAlbumSong & DiscoverRadioSong;

/** What a mix is built from: the engine's sources and the Library its seed's profile is read from. */
export interface CatalogMixSources extends RecommendSources {
  readonly library: GenreProfileLibrary;
}

/** The engine's seed for a mix's [seed]: its artists, its genre profile and style, and a genre mix's family. */
export const catalogMixSeed = (
  seed: DiscoverMixSeed,
  { library, profileOf, styleOf }: Pick<CatalogMixSources, "library" | "profileOf" | "styleOf">,
): RecommendSeed => ({
  artists: mixSeedArtists(seed).map((artist) => artist.name),
  profile: mixSeedProfile(seed, library, profileOf),
  style: mixSeedStyle(seed, library, styleOf ?? (() => undefined)),
  ...(seed.genre === undefined ? {} : { family: seed.genre }),
});

/**
 * [seed]'s songs from the catalog as a radio read would have given them:
 * the engine's ranking (`recommend`) as its radio, each song's genre
 * affinity as the engine judged it, and the songs its seed's radios brought
 * as what its familiar share looks at first. Null when the catalog has no
 * candidate for it yet (it waits for the harvest).
 */
export const catalogMixRead = (
  seed: DiscoverMixSeed,
  sources: CatalogMixSources,
  options: RecommendOptions = {},
): DiscoverMixRead<CatalogMixSong> | null =>
  readOfRanked(seed, recommend(catalogMixSeed(seed, sources), sources, options));

/** [seed]'s read out of the engine's [ranked] songs (`catalogMixRead`). */
const readOfRanked = (seed: DiscoverMixSeed, ranked: readonly RecommendedSong[]) =>
  finishSteps(readOfRankedSteps(seed, ranked));
function* readOfRankedSteps(
  seed: DiscoverMixSeed,
  ranked: readonly RecommendedSong[],
): Generator<void, DiscoverMixRead<CatalogMixSong> | null> {
  if (ranked.length === 0) return null;
  const affinities = new Map<string, MixAffinity>();
  const radio: CatalogMixSong[] = [];
  const familiar: CatalogMixSong[] = [];
  for (const { song, affinity, onSeedRadio } of ranked) {
    yield;
    const entry = { ...song, video: false };
    affinities.set(song.videoId, affinity);
    radio.push(entry);
    if (onSeedRadio) familiar.push(entry);
  }
  return {
    seed,
    radio,
    affinity: (song) => affinities.get(song.videoId) ?? "unknown",
    familiar,
  };
}
/** Seeds' catalog reads that re-rank at once: what a section's sliders move. */
export interface CatalogMixReader {
  readonly readSteps?: (
    seed: DiscoverMixSeed,
    options?: Omit<RecommendOptions, "random" | "neighbourhood">,
  ) => Generator<void, DiscoverMixRead<CatalogMixSong> | null>;
  /**
   * [seed]'s catalog read (`catalogMixRead`) ranked by [options] (the
   * sliders' weights and threshold, a refresh's avoided songs). The engine
   * walks the catalog once per seed (by its id); every read after that only
   * weighs the songs again.
   */
  readonly read: (
    seed: DiscoverMixSeed,
    options?: Omit<RecommendOptions, "random" | "neighbourhood">,
  ) => DiscoverMixRead<CatalogMixSong> | null;
}

/**
 * A reader of seeds' catalog reads over [sources] (`CatalogMixReader`), for
 * one build and the re-ranks after it while [sources] stay the same. With a
 * [variety], each seed's variety nudge is the same whenever it's read, by
 * any reader with that variety (`seededRandom` of it and the seed's id), so
 * a build re-ranked at its sliders makes its mixes again; without one there
 * is no nudge.
 */
export const catalogMixReader = (
  sources: CatalogMixSources,
  {
    variety,
    neighbourhood,
  }: Pick<RecommendOptions, "neighbourhood"> & {
    readonly variety?: number;
  } = {},
): CatalogMixReader => {
  const walks = new Map<string, readonly RecommendCandidate[]>();
  const readSteps = function* (
    seed: DiscoverMixSeed,
    options: Omit<RecommendOptions, "random" | "neighbourhood"> = {},
  ): Generator<void, DiscoverMixRead<CatalogMixSong> | null> {
    let candidates = walks.get(seed.id);
    if (candidates === undefined) {
      candidates = yield* recommendCandidatesSteps(
        yield* catalogMixSeedSteps(seed, sources),
        sources,
        {
          ...(neighbourhood === undefined ? {} : { neighbourhood }),
          ...(variety === undefined ? {} : { random: seededRandom(`${variety}:${seed.id}`) }),
        },
      );
      walks.set(seed.id, candidates);
    }
    return yield* readOfRankedSteps(seed, yield* rankRecommendedSteps(candidates, options));
  };
  return { readSteps, read: (seed, options) => finishSteps(readSteps(seed, options)) };
};

/** What the section's mixes leave out and blend in: the songs the owner knows, the Library, a refresh's avoided songs. */
export interface CatalogMixesOptions<L extends DiscoverLibrarySong>
  extends
    Pick<DiscoverMixPoolSources<L>, "known" | "library">,
    Omit<RecommendOptions, "avoid" | "random" | "neighbourhood"> {
  /** For a refresh: the new songs the section showed today (`mixRefreshAvoid`). */
  readonly avoid?: ReadonlySet<string>;
}

/**
 * The mixes [seeds] make from the catalog, in seed order, as
 * `discoverMixesOfRadios` makes them of radios read: each seed's catalog
 * read by [reader] (`catalogMixReader`: a build's, whose walks a re-rank
 * reuses); a seed with none yet, or fewer than ten new songs, makes no mix,
 * and the section has what the others make. The engine's weights and
 * threshold come in [options] (the sliders'); a refresh's [avoid] goes last
 * in the ranking and only makes up a mix's ten songs.
 */
export const discoverMixesOfCatalog = <L extends DiscoverLibrarySong>(
  seeds: readonly DiscoverMixSeed[],
  reader: CatalogMixReader,
  { known, library, avoid, ...engine }: CatalogMixesOptions<L>,
): DiscoverMix[] => {
  const options = { ...engine, ...(avoid === undefined ? {} : { avoid }) };
  const reads = seeds.flatMap((seed) => reader.read(seed, options) ?? []);
  return discoverMixesOfRadios(reads, {
    known,
    library,
    ...(avoid === undefined ? {} : { avoid }),
  });
};

export function* discoverMixesOfCatalogSteps<L extends DiscoverLibrarySong>(
  seeds: readonly DiscoverMixSeed[],
  reader: CatalogMixReader,
  { known, library, avoid, ...engine }: CatalogMixesOptions<L>,
): Generator<void, DiscoverMix[]> {
  const options = { ...engine, ...(avoid === undefined ? {} : { avoid }) };
  const reads: DiscoverMixRead<CatalogMixSong>[] = [];
  for (const seed of seeds) {
    const read =
      reader.readSteps === undefined
        ? reader.read(seed, options)
        : yield* reader.readSteps(seed, options);
    if (read !== null) reads.push(read);
    yield;
  }
  return yield* discoverMixesOfRadiosSteps(reads, {
    known,
    library,
    ...(avoid === undefined ? {} : { avoid }),
  });
}

export function* catalogMixSeedSteps(
  seed: DiscoverMixSeed,
  { library, profileOf, styleOf }: Pick<CatalogMixSources, "library" | "profileOf" | "styleOf">,
): Generator<void, RecommendSeed> {
  return {
    artists: mixSeedArtists(seed).map((artist) => artist.name),
    profile: yield* mixSeedProfileSteps(seed, library, profileOf),
    style: yield* mixSeedStyleSteps(seed, library, styleOf ?? (() => undefined)),
    ...(seed.genre === undefined ? {} : { family: seed.genre }),
  };
}
