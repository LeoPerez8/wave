/**
 * Home's Magic Queue carousel (docs/spec.md, "Discover's Magic Queue
 * carousel"): the Magic Queue row as pages that swipe sideways, up to nine
 * songs each, a tap on any song starting a Magic Queue seeded by it. Most
 * listened recently holds the songs with the most counted plays in Home's
 * recent window, streamed plays included; the Magic Queue page is the row's
 * random seeds (`magicQueueRow`); Discoveries holds songs never played
 * (`discoveries`).
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import { recentWindowStart } from "./recentWindow.ts";
import { rankSongPlays, type SongPlayTotals, type StatsWindow } from "./stats.ts";
import type { TrackRef } from "./ytMusic.ts";

/**
 * The carousel's pages, in the order they're swiped through. A new page is a
 * new id here, in its place, with its name in the catalogue's
 * `discover.pages`.
 */
export const MAGIC_QUEUE_CAROUSEL_PAGES = [
  "most-listened-recently",
  "magic-queue",
  "discoveries",
] as const;

/** A page of the carousel. */
export type MagicQueueCarouselPageId = (typeof MAGIC_QUEUE_CAROUSEL_PAGES)[number];

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

/**
 * What a page of the carousel shows of its [songs], in their order: the first
 * nine, or none when there are fewer than three (the page is left out).
 */
export const carouselPageSongs = <T>(songs: readonly T[]): T[] =>
  songs.length < CAROUSEL_PAGE_MIN_SONGS ? [] : songs.slice(0, MAGIC_QUEUE_PICKS);

/**
 * The pages the carousel shows, in order, given how many songs (or
 * placeholder tiles) each has to show ([songs]). A page with fewer than three
 * is left out, except the Magic Queue page, which stays with whatever it has:
 * a Library of one song keeps its row.
 */
export const magicQueueCarouselPages = (
  songs: Readonly<Record<MagicQueueCarouselPageId, number>>,
): MagicQueueCarouselPageId[] =>
  MAGIC_QUEUE_CAROUSEL_PAGES.filter(
    (id) => songs[id] >= (id === "magic-queue" ? 1 : CAROUSEL_PAGE_MIN_SONGS),
  );

/**
 * Where the carousel stands among its [pages]: on the page that was showing
 * ([kept], null before any was), or on the first one when that page is left out.
 */
export const magicQueueCarouselPage = (
  pages: readonly MagicQueueCarouselPageId[],
  kept: MagicQueueCarouselPageId | null,
): number => Math.max(0, kept === null ? 0 : pages.indexOf(kept));

/**
 * The page the row remembers: [kept] once there is one (also while that page
 * is missing, so the row returns to it), else the first page drawn. A page
 * that joins before it then moves the row, not the page in sight.
 */
export const magicQueueCarouselKeptPage = (
  pages: readonly MagicQueueCarouselPageId[],
  kept: MagicQueueCarouselPageId | null,
): MagicQueueCarouselPageId | null => kept ?? pages[0] ?? null;

/** The name of the carousel's page [id], in [strings]' language. */
export const magicQueueCarouselPageTitle = (
  id: MagicQueueCarouselPageId,
  strings: Catalogue = en,
): string =>
  id === "magic-queue" ? strings.discover.rows["magic-queue"] : strings.discover.pages[id];

/** What a screen reader hears for the page at [index] of [pages]: its name and its place. */
export const magicQueueCarouselPageLabel = (
  pages: readonly MagicQueueCarouselPageId[],
  index: number,
  strings: Catalogue = en,
): string =>
  strings.discover.pageOf(
    magicQueueCarouselPageTitle(pages[index]!, strings),
    index + 1,
    pages.length,
  );
