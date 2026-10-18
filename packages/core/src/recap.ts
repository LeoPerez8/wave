/**
 * Recaps: a Wrapped-style look back at one calendar period of listening, in
 * the phone's local time, from counted plays (see `isCountedPlay`). This
 * module decides which periods have a Recap, the window each covers, what a
 * Recap holds and the slides it shows, in order.
 */
import { rankPlays, type PlayTotals, type StatsWindow } from "./stats.ts";

/** A calendar month, local time; `month` is 1 (January) to 12. */
export interface RecapMonth {
  readonly kind: "month";
  readonly year: number;
  readonly month: number;
}

/** A calendar year, local time. */
export interface RecapYear {
  readonly kind: "year";
  readonly year: number;
}

/** A period a Recap covers. */
export type RecapPeriod = RecapMonth | RecapYear;

/**
 * Counted listening that started at `startedAt`: one counted play, or the
 * counted plays of a stretch of time summed (the store sums them per quarter
 * hour, which never straddles a local month, since every time zone's offset
 * is a whole number of quarter hours).
 */
export interface CountedListening {
  readonly startedAt: number;
  readonly listenedMs: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** The counted listening a month needs for a Recap. */
export const RECAP_MONTH_MINIMUM_MS = 3 * HOUR_MS;

/** The counted listening a year needs for a Recap. */
export const RECAP_YEAR_MINIMUM_MS = 20 * HOUR_MS;

/** The month (1-12) a year's Recap is out in, covering the year so far. */
const YEAR_RECAP_OUT_MONTH = 12;

/** The local month `time` falls in. */
const monthOf = (time: number): RecapMonth => {
  const date = new Date(time);
  return { kind: "month", year: date.getFullYear(), month: date.getMonth() + 1 };
};

/** When `period` starts, local time. */
const periodStart = (period: RecapPeriod): number =>
  new Date(period.year, period.kind === "month" ? period.month - 1 : 0, 1).getTime();

/** When `period` ends: the start of the next one, local time. */
const periodEnd = (period: RecapPeriod): number =>
  period.kind === "month"
    ? new Date(period.year, period.month, 1).getTime()
    : new Date(period.year + 1, 0, 1).getTime();

/**
 * When `period`'s Recap is out: a month's once it has ended, a year's on
 * 1 December (it then covers the year so far, and is final from 1 January).
 */
const periodOut = (period: RecapPeriod): number =>
  period.kind === "month"
    ? periodEnd(period)
    : new Date(period.year, YEAR_RECAP_OUT_MONTH - 1, 1).getTime();

/** `period`'s id, as routes carry it: "2026-09" for September 2026, "2026" for the year. */
export const recapId = (period: RecapPeriod): string =>
  period.kind === "month"
    ? `${period.year}-${String(period.month).padStart(2, "0")}`
    : String(period.year);

/** The period a `recapId` names, or null for anything else. */
export const parseRecapId = (id: string): RecapPeriod | null => {
  if (/^\d{4}$/.test(id)) return { kind: "year", year: Number(id) };
  const match = /^(\d{4})-(\d{2})$/.exec(id);
  if (match === null) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { kind: "month", year: Number(match[1]), month };
};

/**
 * The plays `period` covers, as the store filters them: from its first
 * instant to its last, local time.
 */
export const recapWindow = (period: RecapPeriod): StatsWindow => ({
  from: periodStart(period),
  to: periodEnd(period) - 1,
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `period` as a Recap's title: "September 2026", or "2026" for the year. */
export const recapTitle = (period: RecapPeriod): string =>
  period.kind === "month" ? `${MONTHS[period.month - 1]} ${period.year}` : String(period.year);

/** How many songs a Recap's top songs list. */
export const RECAP_TOP_SONGS = 5;

/** What a Recap is computed from. */
export interface RecapInput {
  readonly period: RecapPeriod;
  /** Counted listening over any span: only what started within the period counts. */
  readonly listening: readonly CountedListening[];
  /** Each song's counted plays within the period (`recapWindow`), in no order. */
  readonly songs: readonly PlayTotals[];
}

/** One period's Recap. */
export interface Recap {
  readonly period: RecapPeriod;
  readonly title: string;
  /** Whole minutes of counted listening in the period. */
  readonly minutesListened: number;
  /** The period's most played songs, the top one first, as `rankPlays` orders them. */
  readonly topSongs: readonly PlayTotals[];
}

const MINUTE_MS = 60_000;

/** `period`'s Recap from its plays. */
export const recap = ({ period, listening, songs }: RecapInput): Recap => {
  const from = periodStart(period);
  const end = periodEnd(period);
  let listenedMs = 0;
  for (const entry of listening) {
    if (entry.startedAt >= from && entry.startedAt < end) listenedMs += entry.listenedMs;
  }
  return {
    period,
    title: recapTitle(period),
    minutesListened: Math.floor(listenedMs / MINUTE_MS),
    topSongs: rankPlays(songs, RECAP_TOP_SONGS),
  };
};

const minimumMs = (period: RecapPeriod): number =>
  period.kind === "month" ? RECAP_MONTH_MINIMUM_MS : RECAP_YEAR_MINIMUM_MS;

/**
 * Newest first, each year above the months of that year: by year, then the
 * year before its months, then months newest first.
 */
const newestFirst = (a: RecapPeriod, b: RecapPeriod): number =>
  b.year - a.year || (b.kind === "month" ? b.month : 13) - (a.kind === "month" ? a.month : 13);

/**
 * Every period with a Recap at `now`, newest first with each year above its
 * months: each month that has ended and holds at least
 * `RECAP_MONTH_MINIMUM_MS` of counted listening, and each year from
 * 1 December that holds at least `RECAP_YEAR_MINIMUM_MS`.
 */
export const availableRecaps = (
  listening: readonly CountedListening[],
  now: number,
): RecapPeriod[] => {
  const sums = new Map<string, { period: RecapPeriod; listenedMs: number }>();
  const add = (period: RecapPeriod, listenedMs: number): void => {
    const id = recapId(period);
    const sum = sums.get(id);
    sums.set(id, { period, listenedMs: (sum?.listenedMs ?? 0) + listenedMs });
  };
  for (const entry of listening) {
    const month = monthOf(entry.startedAt);
    add(month, entry.listenedMs);
    add({ kind: "year", year: month.year }, entry.listenedMs);
  }
  return (
    [...sums.values()]
      .filter(
        ({ period, listenedMs }) => periodOut(period) <= now && listenedMs >= minimumMs(period),
      )
      .map(({ period }) => period)
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort(newestFirst)
  );
};

/** The `recapId`s opened so far, from what's stored for them (null: none). */
export const parseOpenedRecaps = (stored: string | null): string[] => {
  if (stored === null) return [];
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

/** What to store for the `recapId`s opened so far. */
export const storedOpenedRecaps = (opened: readonly string[]): string => JSON.stringify(opened);

/** `opened` with the Recap `id` opened too. */
export const withRecapOpened = (opened: readonly string[], id: string): readonly string[] =>
  opened.includes(id) ? opened : [...opened, id];

/**
 * The Recap Home's card announces, or null: among `available` (as
 * `availableRecaps` lists them), those out most recently, the first not yet
 * opened (`opened` holds `recapId`s). On 1 December that's the year, then
 * November once the year is opened; an older Recap left unopened isn't
 * announced once a newer one is out.
 */
export const recapToAnnounce = (
  available: readonly RecapPeriod[],
  opened: readonly string[],
): RecapPeriod | null => {
  let latest = Number.NEGATIVE_INFINITY;
  for (const period of available) latest = Math.max(latest, periodOut(period));
  return (
    available.find((period) => periodOut(period) === latest && !opened.includes(recapId(period))) ??
    null
  );
};

/**
 * One slide of a Recap's stories. Each kind carries what it shows; later
 * slides (artists, genres, habits, the summary card) join as new kinds.
 */
export type RecapSlide =
  | { readonly kind: "minutes"; readonly minutes: number }
  | {
      readonly kind: "topSongs";
      /** The top songs, the top one first: it's the one highlighted. */
      readonly songs: readonly PlayTotals[];
    };

/** A Recap's slides, in the order the stories play them. */
export const recapSlides = (shown: Recap): RecapSlide[] => {
  const slides: RecapSlide[] = [{ kind: "minutes", minutes: shown.minutesListened }];
  if (shown.topSongs.length > 0) slides.push({ kind: "topSongs", songs: shown.topSongs });
  return slides;
};

/** How long a slide shows before the stories move on by themselves. */
export const RECAP_SLIDE_MS = 6000;

/** The slide after `index` of `count`, or null when the stories end and close. */
export const recapForward = (index: number, count: number): number | null =>
  index + 1 < count ? index + 1 : null;

/** The slide before `index`; on the first slide, the first again (it restarts). */
export const recapBack = (index: number): number => Math.max(0, index - 1);

/**
 * How full progress bar `bar` is while slide `current` shows, `progress`
 * (0 to 1) of the way through: full for slides already seen, empty for those to come.
 */
export const recapBarFill = (bar: number, current: number, progress: number): number =>
  bar < current ? 1 : bar > current ? 0 : progress;
