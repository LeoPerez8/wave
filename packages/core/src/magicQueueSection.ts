/**
 * Home's Magic Queue section (docs/spec.md, Magic Queue): 10 of the
 * Library's songs to start a Magic Queue from with one tap, picked at random
 * but leaning on the taste profile (favorites and most played likelier,
 * songs the owner skips less likely). A new list each day; pulling the
 * carousel past its start brings another, avoiding the songs it showed
 * today where others are left, with Undo.
 */

import { localDay } from "./discoverMixes.ts";
import type { MagicSong } from "./magicQueue.ts";
import { readStoredRecord } from "./storedJson.ts";
import { tasteWeight, type TasteProfile } from "./tasteProfile.ts";
import { pickWeighted, type RandomSource } from "./weightedPick.ts";

/** How many songs the section shows. */
export const MAGIC_QUEUE_PICKS = 10;

/** What the section shows, as it's kept on the phone. */
export interface MagicQueuePicks {
  /** The calendar day it was picked on (`localDay`). */
  readonly day: string;
  /** The songs it shows, by queue track id, in order. */
  readonly trackIds: readonly string[];
  /** Every song it showed that day, by track id: what a pull avoids. */
  readonly shownToday: readonly string[];
}

/** What a pick weighs and draws with. */
export interface MagicQueuePicking {
  /** When it's picked (ms since the epoch). */
  readonly now: number;
  /** The owner's taste profile; null weighs every song alike. */
  readonly taste: TasteProfile | null;
  readonly random: RandomSource;
}

/** Up to [count] of [songs] at random, the ones [taste] likes likelier. */
const pick = (
  songs: readonly MagicSong[],
  count: number,
  { taste, random }: MagicQueuePicking,
): string[] =>
  pickWeighted(
    songs,
    count,
    (candidate) => (taste === null ? 1 : tasteWeight(taste, candidate)),
    random,
  ).map((picked) => picked.trackId);

/**
 * Up to [count] of [songs] [avoid] doesn't name, picked as `pick` does, then,
 * should those run short, of those it names but [keep] doesn't (the songs
 * shown earlier that day come back last).
 */
const pickAvoiding = (
  songs: readonly MagicSong[],
  count: number,
  { avoid, keep }: { readonly avoid: ReadonlySet<string>; readonly keep: ReadonlySet<string> },
  picking: MagicQueuePicking,
): string[] => {
  const fresh = pick(
    songs.filter((candidate) => !avoid.has(candidate.trackId) && !keep.has(candidate.trackId)),
    count,
    picking,
  );
  const again = pick(
    songs.filter((candidate) => avoid.has(candidate.trackId) && !keep.has(candidate.trackId)),
    count - fresh.length,
    picking,
  );
  return [...fresh, ...again];
};

/**
 * Whether what the section shows ([saved], null for nothing yet) needs
 * picking at [now] with the Library's playable [songs]: nothing picked yet,
 * picked on another day, a song of it gone from the Library, or fewer than
 * 10 songs while the Library has more. Asks nothing of the taste profile.
 */
export const magicQueuePicksDue = (
  saved: MagicQueuePicks | null,
  songs: readonly MagicSong[],
  now: number,
): boolean => {
  if (saved === null || saved.day !== localDay(now)) return true;
  const there = new Set(songs.map((candidate) => candidate.trackId));
  return (
    saved.trackIds.some((id) => !there.has(id)) ||
    saved.trackIds.length < Math.min(MAGIC_QUEUE_PICKS, there.size)
  );
};

/**
 * What the section shows at [now], given what it showed last ([saved], null
 * for nothing yet) and the Library's playable [songs]: [saved] itself unless
 * it's due (`magicQueuePicksDue`); a new list on a new day. A song gone from
 * the Library since is replaced in its place (by one not shown today where
 * others are left), and a list short of 10 songs fills up as the Library
 * grows.
 */
export const magicQueuePicks = (
  saved: MagicQueuePicks | null,
  songs: readonly MagicSong[],
  picking: MagicQueuePicking,
): MagicQueuePicks => {
  if (!magicQueuePicksDue(saved, songs, picking.now)) return saved!;
  const day = localDay(picking.now);
  if (saved === null || saved.day !== day) {
    const trackIds = pick(songs, MAGIC_QUEUE_PICKS, picking);
    return { day, trackIds, shownToday: trackIds };
  }
  const there = new Set(songs.map((candidate) => candidate.trackId));
  const kept = saved.trackIds.filter((id) => there.has(id));
  const added = pickAvoiding(
    songs,
    Math.min(MAGIC_QUEUE_PICKS, there.size) - kept.length,
    { avoid: new Set(saved.shownToday), keep: new Set(kept) },
    picking,
  );
  // Each gone song's place takes the next one picked; the rest join at the end.
  let next = 0;
  const trackIds = saved.trackIds.flatMap((id) =>
    there.has(id) ? [id] : next < added.length ? [added[next++]!] : [],
  );
  trackIds.push(...added.slice(next));
  return { day, trackIds, shownToday: [...new Set([...saved.shownToday, ...trackIds])] };
};

/**
 * What the section shows after a pull past its start at [now]: another list,
 * of songs it didn't show today first, those it did coming back only once
 * no others are left. [saved] is what it showed (`magicQueuePicks`).
 */
export const refreshedMagicQueuePicks = (
  saved: MagicQueuePicks,
  songs: readonly MagicSong[],
  picking: MagicQueuePicking,
): MagicQueuePicks => {
  const day = localDay(picking.now);
  const shown = saved.day === day ? saved.shownToday : [];
  const trackIds = pickAvoiding(
    songs,
    MAGIC_QUEUE_PICKS,
    { avoid: new Set(shown), keep: new Set() },
    picking,
  );
  return { day, trackIds, shownToday: [...new Set([...shown, ...trackIds])] };
};

/**
 * What Undo after a pull puts back: the [previous] list, while the songs
 * the [refreshed] one showed still count as shown today, so the next pull
 * avoids both.
 */
export const undoneMagicQueueRefresh = (
  previous: MagicQueuePicks,
  refreshed: MagicQueuePicks,
): MagicQueuePicks => ({
  day: refreshed.day,
  trackIds: previous.trackIds,
  shownToday: [...new Set([...refreshed.shownToday, ...previous.trackIds])],
});

/** What to keep on the phone for what the section shows. */
export const storedMagicQueuePicks = (picks: MagicQueuePicks): string => JSON.stringify(picks);

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

/** What the section showed as [stored] (`storedMagicQueuePicks`); null when nothing readable is. */
export const parseMagicQueuePicks = (stored: string | null): MagicQueuePicks | null => {
  const { day, trackIds, shownToday } = readStoredRecord(stored);
  const [shows, shown] = [strings(trackIds), strings(shownToday)];
  return typeof day === "string" && shows !== null && shown !== null
    ? { day, trackIds: shows, shownToday: shown }
    : null;
};
