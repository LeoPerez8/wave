/**
 * Pulling a mixes carousel sideways for new mixes (docs/spec.md, "Artist
 * mixes", "Genre mixes"): a refresh rebuilds the pulled section at once, and
 * its new mixes try to be different from what the section showed today.
 * Core remembers the sets a section showed today (`mixesShown`), turns them
 * into what a refresh avoids (`mixRefreshAvoid`: seeds, seed artists and new
 * songs, the least recently shown coming back first when nothing else is
 * left), says how far a pull has gone (`mixPull`) and what Undo puts back
 * (`undoneMixRefresh`). The seeds a refresh picks are `artistMixSeeds`' and
 * `genreMixSeeds`', given the avoid-list.
 */

import type { DiscoverMixes } from "./discoverMixes.ts";
import { identityKey } from "./library.ts";
import { readStoredRecord } from "./storedJson.ts";

/** A set of mixes a section showed, as a refresh remembers it. */
export interface ShownMixes {
  /** The build it was (`DiscoverMixes.builtAt`): a set shown again replaces itself. */
  readonly builtAt: number;
  /** When it was last on show (ms since the epoch). */
  readonly shownAt: number;
  /** Its mixes' ids: their seeds' (`artist:<name>`, `genre:<family>`). */
  readonly mixes: readonly string[];
  /** Its seed artists, by identity key (an artist mix's artist, a genre mix's artists). */
  readonly artists: readonly string[];
  /** Its new songs' video ids. */
  readonly songs: readonly string[];
}

const localDay = (ms: number): string => new Date(ms).toDateString();

/** The sets of [memory] shown on [now]'s calendar day: the memory resets each day. */
const shownToday = (memory: readonly ShownMixes[], now: number): ShownMixes[] =>
  memory.filter((set) => localDay(set.shownAt) === localDay(now));

/**
 * What a section remembers after showing [mixes] at [now]: the sets of
 * [memory] it showed today, then [mixes], the most recently shown last. Pass
 * no memory for the day's automatic build, which starts the memory afresh.
 */
export const mixesShown = (
  memory: readonly ShownMixes[],
  mixes: DiscoverMixes,
  now: number,
): ShownMixes[] => [
  ...shownToday(memory, now).filter((set) => set.builtAt !== mixes.builtAt),
  {
    builtAt: mixes.builtAt,
    shownAt: now,
    mixes: mixes.mixes.map((mix) => mix.id),
    artists: mixes.mixes.flatMap((mix) =>
      (mix.seed.artists ?? [mix.seed.name]).map((name) => identityKey(name)),
    ),
    songs: mixes.mixes.flatMap((mix) => mix.songs.map((song) => song.videoId)),
  },
];

/**
 * What a refresh avoids, where alternatives exist: the seeds, seed artists
 * and new songs of every set the section showed today. Seeds and artists
 * map to when they were last shown, so the least recently shown come back
 * first when nothing different is left.
 */
export interface MixRefreshAvoid {
  /** Mix (seed) ids: a genre mix's family is `genre:<family>`. */
  readonly mixes: ReadonlyMap<string, number>;
  /** Seed artists, by identity key. */
  readonly artists: ReadonlyMap<string, number>;
  /** New songs' video ids. */
  readonly songs: ReadonlySet<string>;
}

/** What a refresh at [now] avoids, from the sets [memory] holds (`mixesShown`) shown today. */
export const mixRefreshAvoid = (memory: readonly ShownMixes[], now: number): MixRefreshAvoid => {
  const mixes = new Map<string, number>();
  const artists = new Map<string, number>();
  const songs = new Set<string>();
  for (const set of shownToday(memory, now)) {
    for (const id of set.mixes) mixes.set(id, Math.max(mixes.get(id) ?? 0, set.shownAt));
    for (const key of set.artists) artists.set(key, Math.max(artists.get(key) ?? 0, set.shownAt));
    for (const videoId of set.songs) songs.add(videoId);
  }
  return { mixes, artists, songs };
};

/**
 * [items] that [shownAt] doesn't name first, in their order, then those it
 * names, the least recently shown first (in their order on a tie). No
 * [shownAt]: [items] as they are.
 */
export const freshFirst = <T>(
  items: readonly T[],
  shownAt: ((item: T) => number | undefined) | null,
): { readonly fresh: T[]; readonly shown: T[] } => {
  if (shownAt === null) return { fresh: [...items], shown: [] };
  const fresh = items.filter((item) => shownAt(item) === undefined);
  const shown = items
    .filter((item) => shownAt(item) !== undefined)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
    .sort((a, b) => (shownAt(a) ?? 0) - (shownAt(b) ?? 0));
  return { fresh, shown };
};

/**
 * What Undo on "New mixes" saves at [now]: the [previous] set back, as the
 * section's build for the day as the [refreshed] one was, so the automatic
 * build doesn't replace it today. It blends at the level as it did. Its
 * build time is [now]'s, so the memory (`mixesShown`) keeps the refreshed
 * set apart from it.
 */
export const undoneMixRefresh = (
  previous: DiscoverMixes,
  refreshed: DiscoverMixes,
  now: number,
): DiscoverMixes => ({
  ...previous,
  builtAt: Math.max(now, refreshed.builtAt + 1),
  playSeeds: previous.playSeeds || refreshed.playSeeds,
});

/** What to save for a section's [memory] (`mixesShown`). */
export const storedMixesShown = (memory: readonly ShownMixes[]): string =>
  JSON.stringify({ sets: memory });

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

const readShownMixes = (value: unknown): ShownMixes[] => {
  if (typeof value !== "object" || value === null) return [];
  const { builtAt, shownAt, mixes, artists, songs } = value as Record<string, unknown>;
  const [ids, keys, videos] = [strings(mixes), strings(artists), strings(songs)];
  if (!isNumber(builtAt) || !isNumber(shownAt) || ids === null || keys === null || videos === null)
    return [];
  return [{ builtAt, shownAt, mixes: ids, artists: keys, songs: videos }];
};

/** A section's memory as [stored] (`storedMixesShown`); none when nothing readable is. */
export const parseMixesShown = (stored: string | null): ShownMixes[] => {
  const { sets } = readStoredRecord(stored);
  return Array.isArray(sets) ? sets.flatMap(readShownMixes) : [];
};

/** How far a finger pulls a mixes carousel past its start before a release refreshes it, in dp. */
export const MIX_PULL_THRESHOLD = 72;

/** The finger travel over which the row's give halves, in dp: the further, the stiffer. */
const PULL_GIVE = 120;

/** Where a pull of a mixes carousel stands. */
export interface MixPull {
  /** How far the row moves right, in dp: less than the finger, more slowly the further it goes. */
  readonly offset: number;
  /** How near a release is to refreshing, from 0 to 1: the refresh arrow's show. */
  readonly progress: number;
  /** A release now refreshes the section (the arrow has turned into a spinner). */
  readonly armed: boolean;
}

/**
 * A pull of a mixes carousel by [drag] dp past its start (rightwards, the
 * "wrong" way). Runs on the UI thread while the finger moves.
 */
export const mixPull = (drag: number): MixPull => {
  "worklet";
  const pulled = Math.max(0, drag);
  return {
    offset: pulled / (1 + pulled / PULL_GIVE),
    progress: Math.min(1, pulled / MIX_PULL_THRESHOLD),
    armed: pulled >= MIX_PULL_THRESHOLD,
  };
};

/**
 * The toast for a refresh whose YouTube Music searches wait for the search
 * allowance, [waitMs] more at most (`searchRoomAt`).
 */
export const mixRefreshWaitNotice = (waitMs: number): string =>
  `Search limit reached · new mixes in about ${Math.max(1, Math.ceil(waitMs / 60_000))} min`;
