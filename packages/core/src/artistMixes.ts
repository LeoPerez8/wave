import { finishSteps, sortSteps } from "./buildSteps.ts";
/**
 * Artist mixes (docs/spec.md, "Artist mixes"): Home's mixes that each grow
 * from one artist's YouTube Music radio. Core picks the artists: the owner's
 * most played, at random each build but leaning towards the most played,
 * then the Library's artists while plays give too few, then artists similar
 * to the Library's, then the top artists of YouTube Music's chart. The radio, the songs
 * a mix keeps and its Library pool are the mixes' shared rules
 * (`discoverMixes.ts`, `discoverMixLevels.ts`).
 */

import { artistPhotoName } from "./artistPhoto.ts";
import type {
  DiscoverLibraryArtist,
  DiscoverMixSeed,
  DiscoverSeedSource,
  DiscoverSimilarArtist,
  DiscoverSimilarArtists,
} from "./discoverMixes.ts";
import { identityKey } from "./library.ts";
import { freshFirstSteps, type MixRefreshAvoid } from "./mixRefresh.ts";
import { pickWeightedSteps, playsWeight, type RandomSource } from "./weightedPick.ts";
import { libraryArtistFinderSteps, ytArtistQuery } from "./ytArtist.ts";
import type { YtChartArtist } from "./ytChart.ts";

/** How many Artist mixes Home shows at most. */
export const ARTIST_MIX_COUNT = 4;

/** How many of the Library's artists with the most songs may seed. */
const LIBRARY_ARTISTS = 20;

/**
 * One of the owner's most played artists, with their all-time counted plays:
 * a Library artist, or an artist only streamed, by the online id Stats ranks
 * them under (`streamedCredits`).
 */
export interface PlayedSeedArtist {
  readonly id: number | string;
  readonly name: string;
  readonly countedPlays: number;
}

/** An artist whose page `artistMixSimilarSource` asks for: a played or a Library one. */
export type SimilarSourceArtist = Pick<PlayedSeedArtist, "id" | "name">;

/** What Artist mixes' seeds are picked from, each source filling what the ones before left short. */
export interface ArtistMixPools {
  /** The owner's all-time most played artists, most played first (as Stats ranks them). */
  readonly played: readonly PlayedSeedArtist[];
  /** The Library's artists, in any order. */
  readonly library?: readonly DiscoverLibraryArtist[];
  /**
   * The similar artists read so far, page by page, in the order
   * `artistMixSimilarSource` asked for them. Used with [library] only.
   */
  readonly similar?: readonly DiscoverSimilarArtists[];
  /**
   * The top artists of YouTube Music's chart, in its order (`ytChart.ts`):
   * the last seeds, for the slots the others leave.
   */
  readonly chart?: readonly YtChartArtist[];
  /** For a refresh: what the section showed today (`mixRefreshAvoid`). */
  readonly avoid?: MixRefreshAvoid;
}

/**
 * [artists] that may seed, in order: each once (by name), none whose name
 * isn't an artist's ("Various Artists") or that [seen] has already.
 */
const seedable = <A extends SimilarSourceArtist>(artists: readonly A[], seen: Set<string>): A[] =>
  finishSteps(seedableSteps(artists, seen));
function* seedableSteps<A extends SimilarSourceArtist>(
  artists: readonly A[],
  seen: Set<string>,
): Generator<void, A[]> {
  const kept: A[] = [];
  for (const artist of artists) {
    const key = identityKey(artist.name);
    if (ytArtistQuery(artist.name) !== null && !seen.has(key)) {
      seen.add(key);
      kept.push(artist);
    }
    yield;
  }
  return kept;
}

const artistSeed = (
  artist: { readonly name: string },
  from: DiscoverSeedSource,
): DiscoverMixSeed => ({
  kind: "artist",
  id: `artist:${identityKey(artist.name)}`,
  name: artist.name,
  from,
});

/** The seeds [pools] give before a refresh brings any back. */
interface SeedPick {
  /** From plays, then the Library, then similar artists; none a refresh avoids. */
  readonly seeds: DiscoverMixSeed[];
  /** The artists a refresh avoids that could seed, the least recently shown first. */
  readonly comeback: DiscoverMixSeed[];
  /**
   * The chart's artists that may seed, for the slots [seeds] and [comeback]
   * leave: those a refresh avoids last, the least recently shown first.
   * None when not asked for.
   */
  readonly chart: DiscoverMixSeed[];
}

function* pickSeedsSteps(
  pools: ArtistMixPools,
  random: RandomSource,
  withChart: boolean,
): Generator<void, SeedPick> {
  const { avoid } = pools;
  const shownAt =
    avoid === undefined
      ? null
      : (artist: { readonly name: string }) => avoid.artists.get(identityKey(artist.name));
  const played = yield* freshFirstSteps(yield* seedableSteps(pools.played, new Set()), shownAt);
  const picked = new Set(
    yield* pickWeightedSteps(
      played.fresh,
      ARTIST_MIX_COUNT,
      (artist) => playsWeight(artist.countedPlays),
      random,
    ),
  );
  const seeds: DiscoverMixSeed[] = [];
  for (const artist of played.fresh) {
    if (picked.has(artist)) seeds.push(artistSeed(artist, "plays"));
    yield;
  }
  const chosen = new Set([...picked].map((artist) => identityKey(artist.name)));
  const bySongs = yield* sortSteps(pools.library ?? [], (a, b) => b.songCount - a.songCount);
  const library = yield* freshFirstSteps(
    yield* seedableSteps(bySongs.slice(0, LIBRARY_ARTISTS), chosen),
    shownAt,
  );
  for (const artist of library.fresh.slice(0, ARTIST_MIX_COUNT - seeds.length))
    seeds.push(artistSeed(artist, "library"));
  const similarPool = yield* similarOfSteps(pools);
  const similar = yield* freshFirstSteps(similarPool, shownAt);
  for (const artist of similar.fresh.slice(0, ARTIST_MIX_COUNT - seeds.length))
    seeds.push({ ...artistSeed(artist, "similar"), browseId: artist.browseId });
  const ids = new Set<string>();
  const comeback: DiscoverMixSeed[] = [];
  for (const [artists, from] of [
    [played.shown, "plays"],
    [library.shown, "library"],
    [similar.shown, "similar"],
  ] as const)
    for (const artist of artists) {
      const seed = {
        ...artistSeed(artist, from),
        ...("browseId" in artist ? { browseId: artist.browseId as string } : {}),
      };
      if (!ids.has(seed.id)) {
        ids.add(seed.id);
        comeback.push(seed);
      }
      yield;
    }
  const chart: DiscoverMixSeed[] = [];
  if (withChart && seeds.length + comeback.length < ARTIST_MIX_COUNT) {
    const fromChart = yield* freshFirstSteps(yield* chartOfSteps(pools, similarPool), shownAt);
    for (const artist of [...fromChart.fresh, ...fromChart.shown])
      chart.push({ ...artistSeed(artist, "chart"), browseId: artist.browseId });
  }
  return {
    seeds,
    comeback: yield* sortSteps(comeback, (a, b) => (shownAt?.(a) ?? 0) - (shownAt?.(b) ?? 0)),
    chart,
  };
}

/**
 * The chart's artists of [pools] that may seed, in its order: each once,
 * none whose name isn't an artist's, that the owner played, that the
 * Library has, or that [similar] holds (by name or by page).
 */
function* chartOfSteps(
  { played, library = [], chart = [] }: ArtistMixPools,
  similar: readonly DiscoverSimilarArtist[],
): Generator<void, YtChartArtist[]> {
  if (chart.length === 0) return [];
  const known: SimilarSourceArtist[] = [];
  for (const source of [played, library])
    for (const artist of source) {
      known.push(artist);
      yield;
    }
  const inLibrary = yield* libraryArtistFinderSteps(known);
  const names = new Set(similar.map((artist) => artistPhotoName(artist.name)));
  const pages = new Set(similar.map((artist) => artist.browseId));
  const kept: YtChartArtist[] = [];
  for (const artist of chart) {
    yield;
    const name = artistPhotoName(artist.name);
    if (ytArtistQuery(artist.name) === null || inLibrary(artist.name) !== null) continue;
    if (names.has(name) || pages.has(artist.browseId)) continue;
    names.add(name);
    pages.add(artist.browseId);
    kept.push(artist);
  }
  return kept;
}

/**
 * The Artist mixes' seeds, four at most. First the owner's most played
 * artists, picked by [random] (`pickWeighted`), the most played more likely
 * (`playsWeight`), most played first. With fewer, the Library's artists with
 * the most songs (of its 20 with the most) fill the rest, then similar
 * artists, then the chart's top artists that none of those already is.
 * Names that aren't an artist's seed nothing, and an artist seeds once. A
 * refresh (`ArtistMixPools.avoid`) passes over the artists the section
 * showed today while others are left, then brings them back, the least
 * recently shown first; chart artists only take the slots still left.
 */
export const artistMixSeeds = (pools: ArtistMixPools, random: RandomSource): DiscoverMixSeed[] => {
  return finishSteps(artistMixSeedsSteps(pools, random));
};
export function* artistMixSeedsSteps(
  pools: ArtistMixPools,
  random: RandomSource,
): Generator<void, DiscoverMixSeed[]> {
  const { seeds, comeback, chart } = yield* pickSeedsSteps(pools, random, true);
  return [...seeds, ...comeback, ...chart].slice(0, ARTIST_MIX_COUNT);
}

/**
 * Whether the chart's artists would seed: when the owner's plays, the
 * Library's artists and the similar artists read (those a refresh avoids
 * too) give fewer than four seeds. Only then is the chart needed.
 */
export const artistMixNeedsChart = (pools: ArtistMixPools): boolean =>
  finishSteps(artistMixNeedsChartSteps(pools));
export function* artistMixNeedsChartSteps(pools: ArtistMixPools): Generator<void, boolean> {
  // The random pick doesn't matter: it never changes how many seed.
  const { seeds, comeback } = yield* pickSeedsSteps(pools, () => 0, false);
  return seeds.length + comeback.length < ARTIST_MIX_COUNT;
}

/**
 * Whether the Library has an artist that can seed Artist mixes (a name
 * that's an artist's): then mixes seeded from the chart alone are built
 * again (`discoverMixesDue`).
 */
export const libraryCanSeedArtistMixes = (artists: readonly { readonly name: string }[]): boolean =>
  artists.some((artist) => ytArtistQuery(artist.name) !== null);

/**
 * Every artist Artist mixes' seeds may be picked from, in their order: the
 * owner's played artists, then, while plays give fewer than four, the
 * Library's (of its 20 with the most songs, the most songs first), then,
 * while those still give fewer, the similar artists, then the chart's.
 */
export const artistMixSeedPool = (pools: ArtistMixPools): DiscoverMixSeed[] => {
  const seen = new Set<string>();
  const seeds = seedable(pools.played, seen).map((artist) => artistSeed(artist, "plays"));
  if (seeds.length >= ARTIST_MIX_COUNT) return seeds;
  const library = seedable(
    [...(pools.library ?? [])]
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort((a, b) => b.songCount - a.songCount)
      .slice(0, LIBRARY_ARTISTS),
    seen,
  );
  seeds.push(...library.map((artist) => artistSeed(artist, "library")));
  if (seeds.length >= ARTIST_MIX_COUNT) return seeds;
  const similar = similarOf(pools);
  for (const artist of similar)
    seeds.push({ ...artistSeed(artist, "similar"), browseId: artist.browseId });
  if (seeds.length >= ARTIST_MIX_COUNT) return seeds;
  for (const artist of finishSteps(chartOfSteps(pools, similar)))
    seeds.push({ ...artistSeed(artist, "chart"), browseId: artist.browseId });
  return seeds;
};

/** How many Library artists' pages are read for similar artists at most. */
const SIMILAR_PAGES = 3;

/**
 * The Library artist whose YouTube Music page to read next for similar
 * artists (to add to `ArtistMixPools.similar`), or null when the seeds have
 * no room left for them or three pages have been read. The owner's most
 * played artists come first, then the Library's with the most songs. A page
 * that couldn't be read counts as read, with no artists. The random pick
 * doesn't matter here: plays leave room only when every played artist seeds.
 */
export const artistMixSimilarSource = (pools: ArtistMixPools): SimilarSourceArtist | null => {
  return finishSteps(artistMixSimilarSourceSteps(pools));
};
export function* artistMixSimilarSourceSteps(
  pools: ArtistMixPools,
): Generator<void, SimilarSourceArtist | null> {
  const { played, library, similar = [] } = pools;
  if (library === undefined || similar.length >= SIMILAR_PAGES) return null;
  // A refresh's avoided artists leave room: pages are read for others first.
  if ((yield* pickSeedsSteps(pools, () => 0, false)).seeds.length >= ARTIST_MIX_COUNT) return null;
  const read = new Set(similar.map((page) => identityKey(page.of)));
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  const byMostSongs = yield* sortSteps(library, (a, b) => b.songCount - a.songCount);
  for (const source of [played, byMostSongs])
    for (const { id, name } of source) {
      yield;
      if (ytArtistQuery(name) === null || read.has(identityKey(name))) continue;
      return { id, name };
    }
  return null;
}

/** The similar artists of [pools] that may seed (`similarPool`), none without the Library. */
const similarOf = (pools: ArtistMixPools): DiscoverSimilarArtist[] =>
  finishSteps(similarOfSteps(pools));
function* similarOfSteps({
  played,
  library,
  similar = [],
}: ArtistMixPools): Generator<void, DiscoverSimilarArtist[]> {
  if (library === undefined) return [];
  const known: SimilarSourceArtist[] = [];
  for (const source of [played, library])
    for (const artist of source) {
      known.push(artist);
      yield;
    }
  return yield* similarPoolSteps(similar, known);
}

/**
 * The similar artists of [similar] that may seed, in order: the pages take
 * turns, each giving its next artist that the Library ([known]) doesn't
 * have, whose name is an artist's and that no page gave before (by name or
 * by page).
 */
function* similarPoolSteps(
  similar: readonly DiscoverSimilarArtists[],
  known: readonly SimilarSourceArtist[],
): Generator<void, DiscoverSimilarArtist[]> {
  const inLibrary = yield* libraryArtistFinderSteps(known);
  const names = new Set<string>();
  const pages = new Set<string>();
  const usable = ({ name, browseId }: DiscoverSimilarArtist): boolean => {
    if (ytArtistQuery(name) === null || inLibrary(name) !== null) return false;
    const key = artistPhotoName(name);
    if (names.has(key) || pages.has(browseId)) return false;
    names.add(key);
    pages.add(browseId);
    return true;
  };
  const next = similar.map(() => 0);
  const pool: DiscoverSimilarArtist[] = [];
  for (let more = true; more;) {
    more = false;
    for (let page = 0; page < similar.length; page++) {
      const { artists } = similar[page]!;
      let added = false;
      for (let at = next[page] ?? artists.length; at < artists.length; at++) {
        const artist = artists[at];
        yield;
        if (artist === undefined || !usable(artist)) continue;
        next[page] = at + 1;
        pool.push(artist);
        added = true;
        more = true;
        break;
      }
      if (!added) next[page] = artists.length;
    }
  }
  return pool;
}
