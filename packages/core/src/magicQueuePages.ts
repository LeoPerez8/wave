/**
 * Discover's Magic Queue row as three pages of nine (docs/spec.md, "Discover's
 * Magic Queue carousel"), every page drawn by one rule from the row's pool
 * (`MagicQueuePool`: the Library's songs with a file and the playlists' YT
 * Music entries): Discover's New music level sets each page's share of songs
 * never played, and its Popularity slider leans the pick towards hits or deep
 * cuts. No taste profile, and no song twice across the pages. A refresh draws
 * one page again and leaves the others as they are.
 */

import type { CatalogSong } from "./candidateCatalog.ts";
import type { DiscoverMixLevel } from "./discoverMixLevels.ts";
import { NO_DISLIKES, withoutDisliked } from "./dislikes.ts";
import { CAROUSEL_PAGE_MIN_SONGS } from "./magicQueueCarousel.ts";
import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import type { MixSliderStep } from "./mixSliders.ts";
import type { MagicQueuePool, MagicQueueSeedId } from "./randomMagicQueuePicks.ts";
import { pickWeighted, type RandomSource } from "./weightedPick.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

/** How many pages the row draws. */
export const MAGIC_QUEUE_PAGES = 3;

/** What the pages are drawn from: the row's pool, with what tells its songs apart. */
export interface MagicQueuePagesPool extends MagicQueuePool {
  /** The songs with a counted play (a Library song's id, an entry's video id); absent: none. */
  readonly played?: ReadonlySet<MagicQueueSeedId>;
  /**
   * How much of a hit a song is, from 0 (unknown, or a deep cut) to 1 (every
   * radio carries it); absent: 0 for every song.
   */
  readonly popularityOf?: (id: MagicQueueSeedId) => number;
}

/** What a draw follows: Discover's levels as they are when it runs, and its randomness. */
export interface MagicQueuePagesDraw {
  /** New music: level fifths of each page never played. */
  readonly level: DiscoverMixLevel;
  /** Popularity: 1 leans to hits, 3 picks evenly, 5 leans to deep cuts. */
  readonly popularity: MixSliderStep;
  readonly random: RandomSource;
}

/** How many levels New music has: level n makes n fifths of a page new. */
const LEVELS = 5;

/** How much more a hit weighs than a deep cut at each step away from the middle. */
const POPULARITY_LEAN = 4;

/** What a page is filled from: the songs no page holds yet, never played and played. */
interface Left {
  readonly fresh: MagicQueueSeedId[];
  readonly familiar: MagicQueueSeedId[];
}

const poolIds = (pool: MagicQueuePagesPool): MagicQueueSeedId[] => [
  ...new Set(
    withoutDisliked<MagicQueueSeedId>(
      [...pool.trackIds, ...pool.videoIds],
      pool.disliked ?? NO_DISLIKES,
      (id) => (typeof id === "number" ? { id } : { videoId: id }),
    ),
  ),
];

const isNew = (pool: MagicQueuePagesPool, id: MagicQueueSeedId): boolean =>
  !(pool.played?.has(id) ?? false);

const leftOf = (pool: MagicQueuePagesPool, ids: readonly MagicQueueSeedId[]): Left => ({
  fresh: ids.filter((id) => isNew(pool, id)),
  familiar: ids.filter((id) => !isNew(pool, id)),
});

/** [fresh] and [familiar] taking turns as evenly as their counts allow, from a new song. */
const interleave = <A>(fresh: readonly A[], familiar: readonly A[]): A[] => {
  const total = fresh.length + familiar.length;
  const newBy = (places: number): number => Math.ceil((places * fresh.length) / total);
  const songs: A[] = [];
  let next = { fresh: 0, familiar: 0 };
  for (let at = 0; at < total; at++)
    if (newBy(at + 1) > newBy(at)) songs.push(fresh[next.fresh++]!);
    else songs.push(familiar[next.familiar++]!);
  return songs;
};

/**
 * One page: [before]'s songs still in [available] in their places, the other
 * places and the rest up to nine filled from [left] (which loses what's taken)
 * so the page's never-played share is New music's as far as the songs allow,
 * each pick weighed by Popularity.
 */
const fillPage = (
  pool: MagicQueuePagesPool,
  draw: MagicQueuePagesDraw,
  left: Left,
  before: readonly MagicQueueSeedId[],
  available: ReadonlySet<MagicQueueSeedId>,
  room: number = MAGIC_QUEUE_PICKS,
): MagicQueueSeedId[] => {
  const kept = before.filter((id) => available.has(id)).slice(0, room);
  const size = Math.min(room, kept.length + left.fresh.length + left.familiar.length);
  const share = Math.round((size * draw.level) / LEVELS);
  const want = Math.max(0, share - kept.filter((id) => isNew(pool, id)).length);
  const lean = 3 - draw.popularity;
  const weight = (id: MagicQueueSeedId): number =>
    POPULARITY_LEAN ** (lean * (Math.min(1, Math.max(0, pool.popularityOf?.(id) ?? 0)) - 0.5));
  const take = (from: MagicQueueSeedId[], count: number): MagicQueueSeedId[] => {
    const picked = pickWeighted(from, Math.max(0, count), weight, draw.random);
    const taken = new Set(picked);
    from.splice(0, from.length, ...from.filter((id) => !taken.has(id)));
    return picked;
  };
  const open = size - kept.length;
  const fresh = take(left.fresh, Math.min(want, open));
  const familiar = take(left.familiar, open - fresh.length);
  fresh.push(...take(left.fresh, open - fresh.length - familiar.length));
  const added = interleave(fresh, familiar);
  let next = 0;
  const placed = before.flatMap((id) =>
    available.has(id) && kept.includes(id) ? [id] : next < added.length ? [added[next++]!] : [],
  );
  return [...placed, ...added.slice(next)].slice(0, room);
};

/** Whether the row leaves out the page at [place]: empty, or after the first and under three. */
const leftOut = (page: readonly MagicQueueSeedId[], place: number): boolean =>
  page.length === 0 || (place > 0 && page.length < CAROUSEL_PAGE_MIN_SONGS);

/**
 * [pages] (changed in place) with each page the row would leave out filled
 * up to nine from the ends of the pages after it, the last first, so only
 * the last pages can be short; then without the pages still left out. A page
 * the row shows keeps its place.
 */
const shown = (pages: MagicQueueSeedId[][]): MagicQueueSeedId[][] => {
  pages.forEach((page, place) => {
    if (!leftOut(page, place)) return;
    for (let from = pages.length - 1; from > place && page.length < MAGIC_QUEUE_PICKS; from--) {
      const donor = pages[from]!;
      page.push(...donor.splice(Math.max(0, donor.length - (MAGIC_QUEUE_PICKS - page.length))));
    }
  });
  return pages.filter((page, place) => !leftOut(page, place));
};

/**
 * The row's pages from [pool]: up to three of nine, no song twice, each page
 * as many never-played songs as New music's share of it ([draw]'s level
 * fifths, rounded), the played ones filling in when there are too few and the
 * other way round, each pick leaning to hits or deep cuts by Popularity. A
 * pool too small for three fills the pages in order, and a page after the
 * first with fewer than three songs is left out. Pass the pages the row shows
 * ([kept]) to keep their songs still in the pool in their places, refilling
 * the others by the same rule; omit it for a fresh draw. A kept page the pool
 * no longer fills takes the later pages' songs before any page is left out,
 * so the pages that stay keep their places.
 */
export const magicQueuePages = (
  pool: MagicQueuePagesPool,
  draw: MagicQueuePagesDraw,
  kept: readonly (readonly MagicQueueSeedId[])[] = [],
): MagicQueueSeedId[][] => {
  const ids = poolIds(pool);
  const available = new Set(ids);
  const before = kept.slice(0, MAGIC_QUEUE_PAGES).map((page) => {
    const seen = new Set<MagicQueueSeedId>();
    return page.filter((id) => !seen.has(id) && (seen.add(id), true));
  });
  const reserved = new Set(before.flat().filter((id) => available.has(id)));
  const left = leftOf(
    pool,
    ids.filter((id) => !reserved.has(id)),
  );
  const pages = Array.from({ length: MAGIC_QUEUE_PAGES }, (_, place) =>
    fillPage(pool, draw, left, before[place] ?? [], available),
  );
  return shown(pages);
};

/**
 * [pages] with the page at [index] drawn again by `magicQueuePages`' rule
 * and the levels of [draw], from the pool's songs no page shows; with too few
 * of those, the page takes its own songs back to stay full. The other pages
 * stay as they are.
 */
export const redrawMagicQueuePage = (
  pool: MagicQueuePagesPool,
  draw: MagicQueuePagesDraw,
  pages: readonly (readonly MagicQueueSeedId[])[],
  index: number,
): MagicQueueSeedId[][] => {
  const own = new Set(pages[index] ?? []);
  const others = new Set(pages.flatMap((page, place) => (place === index ? [] : page)));
  const ids = poolIds(pool).filter((id) => !others.has(id));
  const none = new Set<MagicQueueSeedId>();
  const fresh = fillPage(
    pool,
    draw,
    leftOf(
      pool,
      ids.filter((id) => !own.has(id)),
    ),
    [],
    none,
  );
  const back = fillPage(
    pool,
    draw,
    leftOf(
      pool,
      ids.filter((id) => own.has(id)),
    ),
    [],
    none,
    MAGIC_QUEUE_PICKS - fresh.length,
  );
  return pages.map((page, place) => (place === index ? [...fresh, ...back] : [...page]));
};

/**
 * How much of a hit each song of the pool is (`MagicQueuePagesPool`'s
 * `popularityOf`), from the candidate catalog: the more distinct radios carry
 * a song, the closer to 1 (one radio 0.5, two 0.75), as the radio ranking
 * weighs it. A playlist entry is found by its video, a Library song through
 * the catalog song it is ([inLibrary]), the highest when several are. A song
 * the catalog hasn't is 0.
 */
export function* magicQueuePopularitySteps(
  catalog: readonly CatalogSong[],
  inLibrary: (song: YtAlbumSong) => { readonly id: number } | null,
): Generator<void, (id: MagicQueueSeedId) => number> {
  const byVideo = new Map<string, number>();
  const byTrack = new Map<number, number>();
  for (const entry of catalog) {
    const popularity = 1 - 0.5 ** entry.radios.length;
    byVideo.set(entry.song.videoId, Math.max(popularity, byVideo.get(entry.song.videoId) ?? 0));
    const local = inLibrary(entry.song);
    if (local !== null) byTrack.set(local.id, Math.max(popularity, byTrack.get(local.id) ?? 0));
    yield;
  }
  return (id) => (typeof id === "number" ? byTrack.get(id) : byVideo.get(id)) ?? 0;
}
