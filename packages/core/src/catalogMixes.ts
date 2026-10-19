/**
 * Home's mixes built from the candidate catalog (docs/spec.md, "Artist
 * mixes", "Genre mixes"): each seed's songs are the engine's ranking of the
 * catalog (`recommend`), in place of a radio read now, and the mixes' rules
 * stay theirs (`discoverMixesOfRadios`: no song the owner knows, none in two
 * of a section's mixes, genre affinity, the familiar share, ten songs at
 * least). So a build is at once and offline; the harvest refills the catalog
 * (`harvest.ts`).
 */

import { discoverMixesOfRadios, type DiscoverMixRead } from "./discoverMixRadios.ts";
import type { DiscoverMixPoolSources } from "./discoverMixLevels.ts";
import {
  mixSeedArtists,
  type DiscoverLibrarySong,
  type DiscoverMix,
  type DiscoverMixSeed,
  type DiscoverRadioSong,
} from "./discoverMixes.ts";
import { mixSeedProfile, type GenreProfileLibrary, type MixAffinity } from "./genreAffinity.ts";
import {
  recommend,
  type RecommendOptions,
  type RecommendSeed,
  type RecommendSources,
} from "./recommend.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

/** A catalog song as a mix keeps it: a song, never a music video. */
export type CatalogMixSong = YtAlbumSong & DiscoverRadioSong;

/** What a mix is built from: the engine's sources and the Library its seed's profile is read from. */
export interface CatalogMixSources extends RecommendSources {
  readonly library: GenreProfileLibrary;
}

/** The engine's seed for a mix's [seed]: its artists, its genre profile and a genre mix's family. */
export const catalogMixSeed = (
  seed: DiscoverMixSeed,
  { library, profileOf }: Pick<CatalogMixSources, "library" | "profileOf">,
): RecommendSeed => ({
  artists: mixSeedArtists(seed).map((artist) => artist.name),
  profile: mixSeedProfile(seed, library, profileOf),
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
): DiscoverMixRead<CatalogMixSong> | null => {
  const ranked = recommend(catalogMixSeed(seed, sources), sources, options);
  if (ranked.length === 0) return null;
  const affinities = new Map<string, MixAffinity>();
  const radio: CatalogMixSong[] = [];
  const familiar: CatalogMixSong[] = [];
  for (const { song, affinity, onSeedRadio } of ranked) {
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
};

/** What the section's mixes leave out and blend in: the songs the owner knows, the Library, a refresh's avoided songs. */
export interface CatalogMixesOptions<L extends DiscoverLibrarySong>
  extends Pick<DiscoverMixPoolSources<L>, "known" | "library">, Omit<RecommendOptions, "avoid"> {
  /** For a refresh: the new songs the section showed today (`mixRefreshAvoid`). */
  readonly avoid?: ReadonlySet<string>;
}

/**
 * The mixes [seeds] make from the catalog, in seed order, as
 * `discoverMixesOfRadios` makes them of radios read: each seed's catalog
 * read (`catalogMixRead`); a seed with none yet, or fewer than ten new
 * songs, makes no mix, and the section has what the others make. The
 * engine's weights, threshold and neighbourhood come in [options] (the
 * sliders'); a refresh's [avoid] goes last in the ranking and only makes up
 * a mix's ten songs.
 */
export const discoverMixesOfCatalog = <L extends DiscoverLibrarySong>(
  seeds: readonly DiscoverMixSeed[],
  sources: Omit<CatalogMixSources, "library">,
  { known, library, avoid, ...engine }: CatalogMixesOptions<L>,
): DiscoverMix[] => {
  const options: RecommendOptions = { ...engine, ...(avoid === undefined ? {} : { avoid }) };
  const reads = seeds.flatMap(
    (seed) => catalogMixRead(seed, { ...sources, library }, options) ?? [],
  );
  return discoverMixesOfRadios(reads, {
    known,
    library,
    ...(avoid === undefined ? {} : { avoid }),
  });
};
