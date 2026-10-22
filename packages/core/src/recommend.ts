/**
 * Wave's own recommendation engine (docs/spec.md, "Discover", "Recommendation
 * engine"): it ranks the candidate catalog's songs for a seed (an artist, a
 * genre family's artists, a Magic Queue's radio artists) on the phone, at
 * once and with no request. A song's score adds up named, weighted signals:
 * how close its artists are to the seed (the artist graph), how alike their
 * genres are (genre affinity), how the owner's taste weighs it, how new it is
 * to the catalog and how many catalog radios carry it (popularity). What a
 * section showed today goes last. The weights are a parameter
 * (`RECOMMEND_WEIGHTS` are the defaults), so the sliders can tune them.
 */

import {
  ARTIST_HOP_DECAY,
  ARTIST_NEIGHBOURHOOD_HOPS,
  artistNeighbourhood,
  type ArtistGraph,
  type ArtistNeighbourhoodOptions,
} from "./artistGraph.ts";
import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import {
  GENRE_AFFINITY_THRESHOLD,
  genreAffinity,
  styleOfArtists,
  type GenreProfile,
  type GenreProfileOf,
  type MixAffinity,
  type StyleOf,
} from "./genreAffinity.ts";
import { genreFamily, styleAffinity, type StyleLevel } from "./genreMixes.ts";
import { magicYtSong } from "./magicQueue.ts";
import { tasteWeight, type TasteProfile } from "./tasteProfile.ts";
import type { RandomSource } from "./weightedPick.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { ytTrackId } from "./ytMusic.ts";

/**
 * How much each signal counts in a song's score. Every signal is a number
 * from 0 to 1 (taste from -1 to 1) before it's weighed; a weight of 0 leaves
 * its signal out, and a negative one turns it around (popularity: deep cuts).
 */
export interface RecommendWeights {
  /** How close the song's artists are to the seed: on its radio, or near in the artist graph. */
  readonly closeness: number;
  /** How alike the song's artists' genres are to the seed's (`genreAffinity`). */
  readonly affinity: number;
  /** How the owner's taste profile weighs the song, its artists and its genre (`tasteWeight`). */
  readonly taste: number;
  /** How recently the catalog first saw the song (half every `RECOMMEND_NEWNESS_HALF_LIFE_MS`). */
  readonly newness: number;
  /** How many catalog radios carry the song. */
  readonly popularity: number;
  /** A random nudge, so a seed's mix isn't the same every day ([random] given only). */
  readonly variety: number;
}

/**
 * The default weights: closeness leads, so a seed's mix keeps to its radio
 * and its closest artists as YouTube Music's radio did; genre and taste
 * order what's close; popularity is neutral (YouTube's radio had no say on
 * it either).
 */
export const RECOMMEND_WEIGHTS: RecommendWeights = {
  closeness: 1,
  affinity: 0.5,
  taste: 0.5,
  newness: 0.25,
  popularity: 0,
  variety: 0.25,
};

/** A song the catalog first saw this long ago is half as new. */
export const RECOMMEND_NEWNESS_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** What a recommendation starts from. */
export interface RecommendSeed {
  /**
   * The seed artists: an artist mix's artist, a genre mix's seed artists, a
   * Magic Queue's radio artists. Their radios' songs and their own are as
   * close as can be; their neighbourhood in the artist graph comes after.
   */
  readonly artists: readonly string[];
  /** The genre profile songs are held to (`mixSeedProfile`); null or absent: any genre. */
  readonly profile?: GenreProfile | null;
  /**
   * The seed's style (`mixSeedStyle`, a Magic Queue's `seedStyle`), which
   * [RecommendOptions.styles] holds the songs to; null or absent: unknown.
   */
  readonly style?: string | null;
  /**
   * A genre mix's family (a `genreFamily` name or key): any catalog song
   * whose artist's profile has a share of it is a candidate too, whoever's
   * radio brought it.
   */
  readonly family?: string;
  /** Include genre-compatible songs beyond the graph (playlist recommendations). */
  readonly matchGenres?: boolean;
}

/** What the engine ranks, all of it on the phone. */
export interface RecommendSources {
  /** The candidate catalog. */
  readonly catalog: readonly CatalogSong[];
  /** The artist graph (`artistGraph`); null: only the seeds' radios and songs are close. */
  readonly graph: ArtistGraph | null;
  /** Every artist's genre profile, by name (the Library's, else Deezer's). */
  readonly profileOf: GenreProfileOf;
  /** Every artist's style, by name (the Library's; Deezer has none); absent: no style known. */
  readonly styleOf?: StyleOf;
  /** The owner's taste profile; null or absent weighs every song alike. */
  readonly taste?: TasteProfile | null;
  /** Now (ms since the epoch), for newness. */
  readonly now: number;
  /** Optional track tags; they take precedence over artist-wide genres. */
  readonly songProfileOf?: (song: YtAlbumSong) => GenreProfile | null | undefined;
}

/** How the engine ranks: what the sliders tune. */
export interface RecommendOptions {
  /** Weights over `RECOMMEND_WEIGHTS`. */
  readonly weights?: Partial<RecommendWeights>;
  /** The affinity a song's artist needs to match (`GENRE_AFFINITY_THRESHOLD`). */
  readonly threshold?: number;
  /**
   * At Same genres or Close, the songs' styles are held to the seed's
   * (`styleAffinity`) instead of the threshold: a song of an unknown style
   * stays only when it's close to the seed (`rankRecommended`).
   */
  readonly styles?: StyleLevel;
  /** How far out the seeds' neighbourhood goes (`artistNeighbourhood`). */
  readonly neighbourhood?: ArtistNeighbourhoodOptions;
  /** Songs, by video id, that go after every other (what the section showed today). */
  readonly avoid?: ReadonlySet<string>;
  /** For [RecommendWeights.variety]'s nudge; absent: none. */
  readonly random?: RandomSource;
}

/** A catalog song as the engine ranks it. */
export interface RecommendedSong {
  readonly song: YtAlbumSong;
  /** Its score: the weighed signals added up. Higher ranks first. */
  readonly score: number;
  /**
   * Whether its artists suit the seed's genres: as `mixAffinity` says it at
   * the threshold, or by style at [RecommendOptions.styles] (`rankRecommended`).
   */
  readonly affinity: MixAffinity;
  /** Whether one of the seed artists' radios brought it. */
  readonly onSeedRadio: boolean;
  /** How close its artists are to the seed, from 0 to 1. */
  readonly closeness: number;
}

/** [names]' keys as the catalog and the graph tell artists apart, names that aren't an artist's aside. */
const keysOf = (names: readonly string[]): string[] =>
  names.flatMap((name) => catalogSeedKey(name) ?? []);

/**
 * The closest of [artists]' affinities to [seed] (1 for a seed with no
 * genre: every song matches it), null when none has a genre known.
 */
const affinityOf = (
  artists: readonly string[],
  seed: GenreProfile | null,
  profileOf: GenreProfileOf,
): number | null => {
  if (seed === null) return 1;
  let best: number | null = null;
  for (const artist of artists) {
    const profile = profileOf(artist);
    if (profile === null || profile === undefined) continue;
    best = Math.max(best ?? 0, genreAffinity(seed, profile));
  }
  return best;
};

/** How an affinity (`affinityOf`) holds at [threshold]. */
const affinityAt = (affinity: number | null, threshold: number): MixAffinity =>
  affinity === null ? "unknown" : affinity >= threshold ? "match" : "miss";

/**
 * How a candidate's style holds at [level] (`styleAffinity`): a song of an
 * unknown style is a miss unless it's close to the seed (a closeness above
 * 0: its radio, its seed artists or their neighbourhood).
 */
const styleAt = (candidate: RecommendCandidate, level: StyleLevel): MixAffinity => {
  const affinity = styleAffinity(candidate.seedStyle, candidate.style, level);
  return affinity === "unknown" && candidate.closeness === 0 ? "miss" : affinity;
};

/** Whether one of [artists]' profiles has a share of the family [key]. */
const inFamily = (artists: readonly string[], key: string, profileOf: GenreProfileOf): boolean =>
  artists.some((artist) => (profileOf(artist)?.get(key) ?? 0) > 0);

/**
 * A catalog song as the engine found it for a seed, before it's weighed:
 * its signals, each from 0 to 1 (taste from -1 to 1). Weighing them again
 * is all a slider move costs (`rankRecommended`).
 */
export interface RecommendCandidate {
  readonly entry: CatalogSong;
  /** Whether one of the seed artists' radios brought it. */
  readonly onSeedRadio: boolean;
  readonly closeness: number;
  /** Its closest artist's genre affinity to the seed; null when none of its artists has a genre known. */
  readonly affinity: number | null;
  /** Its style (`styleOfArtists`) and the seed's (`RecommendSeed.style`), for `styles`. */
  readonly style: string | null;
  readonly seedStyle: string | null;
  readonly taste: number;
  readonly newness: number;
  readonly popularity: number;
  readonly variety: number;
}

/**
 * [seed]'s candidates in [sources]' catalog, in the catalog's order, each
 * with its signals (`RecommendCandidate`): the engine's walk over the
 * catalog, which weights, threshold and avoided songs don't change.
 * [options]' random gives each its variety nudge, in that order.
 */
export const recommendCandidates = (
  seed: RecommendSeed,
  sources: RecommendSources,
  options: Pick<RecommendOptions, "neighbourhood" | "random"> = {},
): RecommendCandidate[] => {
  const { catalog, graph, profileOf, taste, now } = sources;
  const profile = seed.profile ?? null;
  const seeds = new Set(keysOf(seed.artists));
  const near = new Map<string, number>();
  if (graph !== null)
    for (const neighbour of artistNeighbourhood(graph, seed.artists, {
      hops: options.neighbourhood?.hops ?? ARTIST_NEIGHBOURHOOD_HOPS,
      decay: options.neighbourhood?.decay ?? ARTIST_HOP_DECAY,
    }))
      near.set(neighbour.key, neighbour.closeness);
  const family = seed.family === undefined ? null : (genreFamily(seed.family)?.key ?? null);
  const candidates: RecommendCandidate[] = [];
  for (const entry of catalog) {
    const { song } = entry;
    const artists = keysOf(song.artists);
    const onSeedRadio = entry.radios.some((radio) => seeds.has(radio.seed));
    let closeness = onSeedRadio ? 1 : 0;
    for (const artist of artists)
      closeness = Math.max(closeness, seeds.has(artist) ? 1 : (near.get(artist) ?? 0));
    const songProfile = sources.songProfileOf?.(song);
    const affinity =
      profile !== null && songProfile != null
        ? genreAffinity(profile, songProfile)
        : affinityOf(song.artists, profile, profileOf);
    if (
      closeness === 0 &&
      !(
        seed.matchGenres === true &&
        profile !== null &&
        affinity !== null &&
        affinity >= GENRE_AFFINITY_THRESHOLD
      ) &&
      (family === null || !inFamily(song.artists, family, profileOf))
    )
      continue;
    const liked =
      taste === null || taste === undefined
        ? 0
        : Math.log2(
            tasteWeight(
              taste,
              magicYtSong({ trackId: ytTrackId(song.videoId), artists: song.artists }, profileOf),
            ),
          ) / 4;
    candidates.push({
      entry,
      onSeedRadio,
      closeness,
      affinity,
      style: styleOfArtists(song.artists, sources.styleOf),
      seedStyle: seed.style ?? null,
      taste: liked,
      newness: 0.5 ** (Math.max(0, now - entry.firstSeenAt) / RECOMMEND_NEWNESS_HALF_LIFE_MS),
      popularity: 1 - 0.5 ** entry.radios.length,
      variety: options.random === undefined ? 0 : options.random(),
    });
  }
  return candidates;
};

const byVideoId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * [candidates] (`recommendCandidates`) best first: each scores its signals
 * weighed by [options]' weights (`RecommendWeights`) and says how its genre
 * affinity holds at [options]' threshold; the songs [options] avoid go after
 * every other. Ties go to the song the catalog saw first, then by video id.
 */
export const rankRecommended = (
  candidates: readonly RecommendCandidate[],
  options: Pick<RecommendOptions, "weights" | "threshold" | "styles" | "avoid"> = {},
): RecommendedSong[] => {
  const weights = { ...RECOMMEND_WEIGHTS, ...options.weights };
  const threshold = options.threshold ?? GENRE_AFFINITY_THRESHOLD;
  const ranked = candidates.map((candidate) => ({
    candidate,
    score:
      weights.closeness * candidate.closeness +
      weights.affinity * (candidate.affinity ?? 0) +
      weights.taste * candidate.taste +
      weights.newness * candidate.newness +
      weights.popularity * candidate.popularity +
      weights.variety * candidate.variety,
    avoided: options.avoid?.has(candidate.entry.song.videoId) === true,
  }));
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array map made; Hermes lacks toSorted
  ranked.sort(
    (a, b) =>
      Number(a.avoided) - Number(b.avoided) ||
      b.score - a.score ||
      a.candidate.entry.firstSeenAt - b.candidate.entry.firstSeenAt ||
      byVideoId(a.candidate.entry.song.videoId, b.candidate.entry.song.videoId),
  );
  return ranked.map(({ candidate, score }) => ({
    song: candidate.entry.song,
    score,
    affinity:
      options.styles === undefined
        ? affinityAt(candidate.affinity, threshold)
        : styleAt(candidate, options.styles),
    onSeedRadio: candidate.onSeedRadio,
    closeness: candidate.closeness,
  }));
};

/**
 * [seed]'s candidates in [sources]' catalog, best first: the songs one of
 * the seed artists' radios brought or by a seed artist (as close as can be),
 * the songs of artists in the seeds' neighbourhood in the artist graph (as
 * close as it says), and, for a genre family, any song whose artist's
 * profile has a share of it. Each scores its signals weighed by [options]'
 * weights (`RecommendWeights`); the songs [options] avoid go after every
 * other. Songs the owner knows aren't left out: what a mix keeps is
 * `discoverMixSongs`'s, and its familiar share takes them. Ties go to the
 * song the catalog saw first, then by video id. The walk
 * (`recommendCandidates`) and the weighing (`rankRecommended`) come apart,
 * so sliders weigh one walk again.
 */
export const recommend = (
  seed: RecommendSeed,
  sources: RecommendSources,
  options: RecommendOptions = {},
): RecommendedSong[] => rankRecommended(recommendCandidates(seed, sources, options), options);
