import { en, type Catalogue } from "./catalogueEn.ts";
/**
 * Listening stats: rankings of the songs, albums and artists played most over
 * a stats period, a rolling window ending now. Only counted plays (see
 * `isCountedPlay`) enter a ranking, and artists are credited by track artist.
 */
import { sortSteps } from "./buildSteps.ts";
import { compareRefIds, compareTrackRefs } from "./refOrder.ts";
import type { TrackRef } from "./ytMusic.ts";

/** A stats period: a rolling window ending now. */
export type StatsPeriod = "week" | "month" | "year" | "all";

/** A period as the Stats screen names it. */
export interface StatsPeriodOption {
  readonly id: StatsPeriod;
  readonly label: string;
  /** The label on the period selector's tab, where four must fit across. */
  readonly tab: string;
}

/** The periods the Stats screen offers, from the shortest to all time, in [strings]' language. */
export const statsPeriods = (strings: Catalogue = en): readonly StatsPeriodOption[] =>
  (["week", "month", "year", "all"] as const).map((id) => ({ id, ...strings.stats.periods[id] }));

/** The periods the Stats screen offers, in English. */
export const STATS_PERIODS: readonly StatsPeriodOption[] = statsPeriods(en);

/** The plays a period covers: started at or after `from` (no start for all time) and at or before `to`. */
export interface StatsWindow {
  readonly from: number | null;
  readonly to: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The same moment a year before `now` (UTC); from a leap day, the last day of February. */
const yearBefore = (now: number): number => {
  const date = new Date(now);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  // 29 February rolled over into March: step back to the last day of February.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.getTime();
};

/** How many entries a ranking shows on the Stats screen. */
export const STATS_TOP = 10;
/** How many entries a ranking's See all shows. */
export const STATS_SEE_ALL = 100;

/**
 * What the library sums up for one entity (a song, an album, an artist) over
 * a stats window, counting only counted plays.
 */
export interface PlayTotals {
  readonly id: number;
  /** The entity's sort key (title or name), the last tie-break before the id. */
  readonly sortKey: string;
  readonly countedPlays: number;
  /** Time listened over its counted plays. */
  readonly listenedMs: number;
  /** When its latest counted play started. */
  readonly latestPlayAt: number;
}

/** An album or artist's totals, including an online identity while absent from the Library. */
export type EntityPlayTotals = Omit<PlayTotals, "id"> & { readonly id: number | string };

/** Most played first as `rankPlays` ranks, then Library ids in order before online ones. */
const compareEntities = (a: EntityPlayTotals, b: EntityPlayTotals): number =>
  compareTotals(a, b) || compareRefIds(a.id, b.id);

export const rankEntityPlays = <A extends EntityPlayTotals>(
  totals: readonly A[],
  limit: number,
): A[] =>
  totals
    .filter((entry) => entry.countedPlays > 0)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort(compareEntities)
    .slice(0, limit);

/** `rankEntityPlays` in scheduler-independent bounded work steps. */
export function* rankEntityPlaysSteps<A extends EntityPlayTotals>(
  totals: Iterable<A>,
  limit: number,
): Generator<void, A[]> {
  const eligible: A[] = [];
  for (const entry of totals) {
    if (entry.countedPlays > 0) eligible.push(entry);
    yield;
  }
  return (yield* sortSteps(eligible, compareEntities)).slice(0, limit);
}

type Totals = Omit<PlayTotals, "id">;

const compareTotals = (a: Totals, b: Totals): number =>
  b.countedPlays - a.countedPlays ||
  b.listenedMs - a.listenedMs ||
  b.latestPlayAt - a.latestPlayAt ||
  (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

const compareRanked = (a: PlayTotals, b: PlayTotals): number => compareTotals(a, b) || a.id - b.id;

/**
 * The top `limit` entities: most counted plays first, then most listened time,
 * then the most recent play, then by sort key and id, so the order never
 * depends on how the totals arrived. Entities without a counted play are left out.
 */
export const rankPlays = <A extends PlayTotals>(totals: readonly A[], limit: number): A[] =>
  totals
    .filter((entry) => entry.countedPlays > 0)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort(compareRanked)
    .slice(0, limit);

/**
 * A song's totals over a stats window: a Library song's, its streamed plays
 * included once it has their video id or recording key, or a streamed song's,
 * one entry across its plays, by video id.
 */
export interface SongPlayTotals extends Totals {
  readonly song: TrackRef;
}

/**
 * The top `limit` songs, streamed and Library ones together, by `rankPlays`'
 * rule; a full tie goes to the Library song, then by id.
 */
export const rankSongPlays = <A extends SongPlayTotals>(totals: readonly A[], limit: number): A[] =>
  totals
    .filter((entry) => entry.countedPlays > 0)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort((a, b) => compareTotals(a, b) || compareTrackRefs(a.song, b.song))
    .slice(0, limit);

/**
 * What the library sums up for the tracks of one album crediting one artist
 * over a stats window, counting only counted plays. Albums and artists are
 * both ranked from these. A collaboration's plays are in a row for each
 * artist it credits, only one of which is `primary`.
 */
export interface CreditedPlayTotals {
  /** The album (title + album artist, as in the Library). */
  readonly albumId: number;
  readonly albumSort: string;
  /**
   * An artist the tracks' credit names: on a compilation, the real artist,
   * not "Various Artists".
   */
  readonly artistId: number;
  readonly artistSort: string;
  /**
   * Whether the artist is the tracks' primary artist (the first their credit
   * names that is in the library): each play is in exactly one primary row.
   */
  readonly primary: boolean;
  readonly countedPlays: number;
  readonly listenedMs: number;
  readonly latestPlayAt: number;
}

/** Sums credited totals into one entry per entity, as `entity` picks it. */
const sumBy = (
  credits: readonly CreditedPlayTotals[],
  entity: (credit: CreditedPlayTotals) => { readonly id: number; readonly sortKey: string },
): PlayTotals[] => {
  const byId = new Map<number, PlayTotals>();
  for (const credit of credits) {
    const { id, sortKey } = entity(credit);
    const sum = byId.get(id);
    byId.set(id, {
      id,
      sortKey,
      countedPlays: (sum?.countedPlays ?? 0) + credit.countedPlays,
      listenedMs: (sum?.listenedMs ?? 0) + credit.listenedMs,
      latestPlayAt: Math.max(sum?.latestPlayAt ?? 0, credit.latestPlayAt),
    });
  }
  return [...byId.values()];
};

/**
 * Each album's totals: the plays of all its tracks, whoever the track artists,
 * a collaboration's plays counted once. Ranked by `rankPlays`.
 */
export const albumPlayTotals = (credits: readonly CreditedPlayTotals[]): PlayTotals[] =>
  sumBy(
    credits.filter((credit) => credit.primary),
    (credit) => ({ id: credit.albumId, sortKey: credit.albumSort }),
  );

/**
 * Each artist's totals, credited by track artist: a collaboration's plays
 * count in full for each artist it credits, and a compilation's go to the
 * artists on its tracks, never to its album artist. Ranked by `rankPlays`.
 */
export const artistPlayTotals = (credits: readonly CreditedPlayTotals[]): PlayTotals[] =>
  sumBy(credits, (credit) => ({ id: credit.artistId, sortKey: credit.artistSort }));

/** The window `period` covers when the ranking is read at `now`. */
export const statsWindow = (period: StatsPeriod, now: number): StatsWindow => {
  switch (period) {
    case "week":
      return { from: now - 7 * DAY_MS, to: now };
    case "month":
      return { from: now - 30 * DAY_MS, to: now };
    case "year":
      return { from: yearBefore(now), to: now };
    case "all":
      return { from: null, to: now };
  }
};

/** The same total ranking, in scheduler-independent bounded work steps. */
export function* rankPlaysSteps<A extends PlayTotals>(
  totals: Iterable<A>,
  limit: number,
): Generator<void, A[]> {
  const eligible: A[] = [];
  for (const entry of totals) {
    if (entry.countedPlays > 0) eligible.push(entry);
    yield;
  }
  return (yield* sortSteps(eligible, compareRanked)).slice(0, limit);
}
