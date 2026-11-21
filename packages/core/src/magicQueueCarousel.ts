/**
 * Home's Magic Queue carousel (docs/spec.md, "Discover's Magic Queue
 * carousel"): the Magic Queue row as pages that swipe sideways, up to nine
 * songs each, a tap on any song starting a Magic Queue seeded by it. Every
 * page is drawn by the same rule (`magicQueuePages`), so the pages have no
 * names of their own. The recent window's ranking here is In your orbit's.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import type { MagicQueueSeed } from "./magicQueueRow.ts";
import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import { recentWindowStart } from "./recentWindow.ts";
import { rankSongPlays, type SongPlayTotals, type StatsWindow } from "./stats.ts";
import type { TrackRef } from "./ytMusic.ts";

/** A page with fewer songs than this is left out of the carousel. */
export const CAROUSEL_PAGE_MIN_SONGS = 3;

/** The plays "recently" covers at [now], as the window Stats' totals are summed over. */
export const recentPlaysWindow = (now: number): StatsWindow => ({
  from: recentWindowStart(now),
  to: now,
});

/** What a carousel row shows: its page width, its pages' keys in order, and the page in sight. */
export interface MagicQueueCarouselRow {
  readonly width: number;
  readonly pages: readonly string[];
  readonly index: number;
}

/**
 * Whether the carousel's row starts over at its page between [before] and
 * [now]: when its width changed, or when the page in sight is the same page
 * but the pages before it changed, so it sits at another offset. A swipe (the
 * page in sight changes) and a page joining or leaving after the one in sight
 * leave the row as it is.
 */
export const magicQueueCarouselRestarts = (
  before: MagicQueueCarouselRow,
  now: MagicQueueCarouselRow,
): boolean => {
  if (before.width !== now.width) return true;
  if (before.pages[before.index] !== now.pages[now.index]) return false;
  return (
    before.index !== now.index ||
    before.pages.slice(0, before.index).some((page, place) => page !== now.pages[place])
  );
};

/**
 * The songs played in the recent window, the most counted plays first (as
 * Stats ranks songs: then the most time listened, then the latest play), given
 * each song's [totals] over `recentPlaysWindow`: a Library song's with the
 * streamed plays that are its own, and a streamed song the Library hasn't.
 * Songs without a counted play are left out. Every ranked song comes back, so
 * the caller can pass over one it can't show before `carouselPageSongs` cuts
 * the page.
 */
export const mostListenedRecently = (totals: readonly SongPlayTotals[]): TrackRef[] =>
  rankSongPlays(totals, totals.length).map((entry) => entry.song);

/** How many recently played songs In your orbit needs to show. */
export const IN_YOUR_ORBIT_SONGS = 9;

/**
 * Home's In your orbit, given the recently most listened [songs] that can
 * show, in their order (`mostListenedRecently`, those that can't show passed
 * over): the first nine, or none while fewer than nine can (the section is
 * left out).
 */
export const inYourOrbitSongs = <T>(songs: readonly T[]): T[] =>
  songs.length < IN_YOUR_ORBIT_SONGS ? [] : songs.slice(0, IN_YOUR_ORBIT_SONGS);

/** What a tap on an In your orbit tile does (`inYourOrbitTap`). */
export type InYourOrbitTap<T> =
  /** Starts a Magic Queue seeded by the tapped song. */
  | { readonly kind: "magicQueue"; readonly seed: MagicQueueSeed<T> }
  /** Plays these Library songs in their order, from the one at [start]. */
  | { readonly kind: "play"; readonly songs: readonly T[]; readonly start: number }
  | { readonly kind: "none" };

/**
 * Whether In your orbit's [tile] shows unavailable: a streamed song can't
 * play with YT Music off ([ytMusic]), as other streamed songs can't.
 */
export const inYourOrbitTileUnavailable = <T>(tile: MagicQueueSeed<T>, ytMusic: boolean): boolean =>
  tile.source === "stream" && !ytMusic;

/**
 * What a tap on the In your orbit tile at [index] of [tiles] does: with YT
 * Music on ([ytMusic]), it starts a Magic Queue from the song. With YT Music
 * off a Magic Queue can't start, so it plays the grid's Library songs in their
 * order from the tapped one; a streamed tile can't play then, and its tap
 * does nothing.
 */
export const inYourOrbitTap = <T>(
  tiles: readonly MagicQueueSeed<T>[],
  index: number,
  ytMusic: boolean,
): InYourOrbitTap<T> => {
  const tapped = tiles[index];
  if (tapped === undefined || inYourOrbitTileUnavailable(tapped, ytMusic)) return { kind: "none" };
  if (ytMusic) return { kind: "magicQueue", seed: tapped };
  const own = (from: readonly MagicQueueSeed<T>[]): T[] =>
    from.flatMap((tile) => (tile.source === "library" ? [tile.song] : []));
  return { kind: "play", songs: own(tiles), start: own(tiles.slice(0, index)).length };
};

/**
 * What a page of the carousel shows of its [songs], in their order: the first
 * nine, or none when there are fewer than three (the page is left out).
 */
export const carouselPageSongs = <T>(songs: readonly T[]): T[] =>
  songs.length < CAROUSEL_PAGE_MIN_SONGS ? [] : songs.slice(0, MAGIC_QUEUE_PICKS);

/**
 * Where the carousel stands among its [count] pages: on the page that was
 * showing ([kept], null before any was), or on the last one while that page
 * is left out.
 */
export const magicQueueCarouselPage = (count: number, kept: number | null): number =>
  Math.max(0, Math.min(count - 1, kept ?? 0));

/** What a screen reader hears for the page at [index] of [count]: the row's name and the page's place. */
export const magicQueueCarouselPageLabel = (
  index: number,
  count: number,
  strings: Catalogue = en,
): string => strings.discover.pageOf(strings.discover.rows["magic-queue"], index + 1, count);
