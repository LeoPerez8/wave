/**
 * Artist mixes (docs/spec.md, "Artist mixes"): Home's mixes that each grow
 * from one artist's YouTube Music radio. Core picks the artists: the owner's
 * most played, at random each build but leaning towards the most played,
 * then the Library's artists while plays give too few. The radio, the songs
 * a mix keeps and its Library pool are the mixes' shared rules
 * (`discoverMixes.ts`, `discoverMixLevels.ts`).
 */

import { artistPhotoName } from "./artistPhoto.ts";
import type {
  DiscoverLibraryArtist,
  DiscoverMixSeed,
  DiscoverSeedArtist,
  DiscoverSeedSource,
  DiscoverSimilarArtist,
  DiscoverSimilarArtists,
} from "./discoverMixes.ts";
import { identityKey } from "./library.ts";
import { pickWeighted, playsWeight, type RandomSource } from "./weightedPick.ts";
import { libraryArtistFinder, ytArtistQuery } from "./ytArtist.ts";

/** How many Artist mixes Home shows at most. */
export const ARTIST_MIX_COUNT = 4;

/** How many of the Library's artists with the most songs may seed. */
const LIBRARY_ARTISTS = 20;

/** One of the owner's most played artists, with their all-time counted plays. */
export interface PlayedSeedArtist extends DiscoverSeedArtist {
  readonly countedPlays: number;
}

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
}

/**
 * [artists] that may seed, in order: each once (by name), none whose name
 * isn't an artist's ("Various Artists") or that [seen] has already.
 */
const seedable = <A extends DiscoverSeedArtist>(artists: readonly A[], seen: Set<string>): A[] =>
  artists.filter((artist) => {
    const key = identityKey(artist.name);
    if (ytArtistQuery(artist.name) === null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

const artistSeed = (
  artist: { readonly name: string },
  from: DiscoverSeedSource,
): DiscoverMixSeed => ({
  kind: "artist",
  id: `artist:${identityKey(artist.name)}`,
  name: artist.name,
  from,
});

/**
 * The Artist mixes' seeds, four at most. First the owner's most played
 * artists, picked by [random] (`pickWeighted`), the most played more likely
 * (`playsWeight`), most played first. With fewer, the Library's artists with
 * the most songs (of its 20 with the most) fill the rest. Names that aren't
 * an artist's seed nothing, and an artist seeds once.
 */
export const artistMixSeeds = (pools: ArtistMixPools, random: RandomSource): DiscoverMixSeed[] => {
  const seen = new Set<string>();
  const played = seedable(pools.played, seen);
  const picked = new Set(
    pickWeighted(played, ARTIST_MIX_COUNT, (artist) => playsWeight(artist.countedPlays), random),
  );
  const seeds = played
    .filter((artist) => picked.has(artist))
    .map((artist) => artistSeed(artist, "plays"));
  const chosen = new Set([...picked].map((artist) => identityKey(artist.name)));
  const library = seedable(
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    [...(pools.library ?? [])].sort((a, b) => b.songCount - a.songCount).slice(0, LIBRARY_ARTISTS),
    chosen,
  );
  for (const artist of library.slice(0, ARTIST_MIX_COUNT - seeds.length))
    seeds.push(artistSeed(artist, "library"));
  for (const artist of similarOf(pools).slice(0, ARTIST_MIX_COUNT - seeds.length))
    seeds.push({ ...artistSeed(artist, "similar"), browseId: artist.browseId });
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
export const artistMixSimilarSource = (pools: ArtistMixPools): DiscoverSeedArtist | null => {
  const { played, library, similar = [] } = pools;
  if (library === undefined || similar.length >= SIMILAR_PAGES) return null;
  const room = ARTIST_MIX_COUNT - artistMixSeeds({ played, library }, () => 0).length;
  if (similarOf(pools).length >= room) return null;
  const read = new Set(similar.map((page) => identityKey(page.of)));
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  const byMostSongs = [...library].sort((a, b) => b.songCount - a.songCount);
  for (const { id, name } of [...played, ...byMostSongs]) {
    if (ytArtistQuery(name) === null || read.has(identityKey(name))) continue;
    return { id, name };
  }
  return null;
};

/** The similar artists of [pools] that may seed (`similarPool`), none without the Library. */
const similarOf = ({ played, library, similar = [] }: ArtistMixPools): DiscoverSimilarArtist[] =>
  library === undefined ? [] : similarPool(similar, [...played, ...library]);

/**
 * The similar artists of [similar] that may seed, in order: the pages take
 * turns, each giving its next artist that the Library ([known]) doesn't
 * have, whose name is an artist's and that no page gave before (by name or
 * by page).
 */
const similarPool = (
  similar: readonly DiscoverSimilarArtists[],
  known: readonly DiscoverSeedArtist[],
): DiscoverSimilarArtist[] => {
  const inLibrary = libraryArtistFinder(known);
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
    similar.forEach(({ artists }, page) => {
      for (let at = next[page] ?? artists.length; at < artists.length; at++) {
        const artist = artists[at];
        if (artist === undefined || !usable(artist)) continue;
        next[page] = at + 1;
        pool.push(artist);
        more = true;
        return;
      }
      next[page] = artists.length;
    });
  }
  return pool;
};
