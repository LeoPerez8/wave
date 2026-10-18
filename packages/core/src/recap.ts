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

/** A period a Recap covers. */
export type RecapPeriod = RecapMonth;

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

/** The local month `time` falls in. */
const monthOf = (time: number): RecapMonth => {
  const date = new Date(time);
  return { kind: "month", year: date.getFullYear(), month: date.getMonth() + 1 };
};

/** When `period` starts, local time. */
const periodStart = (period: RecapPeriod): number =>
  new Date(period.year, period.month - 1, 1).getTime();

/** When `period` ends: the start of the next one, local time. */
const periodEnd = (period: RecapPeriod): number => new Date(period.year, period.month, 1).getTime();

/** `period`'s id, as routes carry it: "2026-09" for September 2026. */
export const recapId = (period: RecapPeriod): string =>
  `${period.year}-${String(period.month).padStart(2, "0")}`;

/** The period a `recapId` names, or null for anything else. */
export const parseRecapId = (id: string): RecapPeriod | null => {
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

/** `period` as a Recap's title: "September 2026". */
export const recapTitle = (period: RecapPeriod): string =>
  `${MONTHS[period.month - 1]} ${period.year}`;

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

/**
 * Every period with a Recap at `now`, newest first: each month that has
 * ended and holds at least `RECAP_MONTH_MINIMUM_MS` of counted listening.
 */
export const availableRecaps = (
  listening: readonly CountedListening[],
  now: number,
): RecapPeriod[] => {
  const byMonth = new Map<string, { period: RecapMonth; listenedMs: number }>();
  for (const entry of listening) {
    const period = monthOf(entry.startedAt);
    const id = recapId(period);
    const sum = byMonth.get(id);
    byMonth.set(id, { period, listenedMs: (sum?.listenedMs ?? 0) + entry.listenedMs });
  }
  return (
    [...byMonth.values()]
      .filter(
        ({ period, listenedMs }) =>
          periodEnd(period) <= now && listenedMs >= RECAP_MONTH_MINIMUM_MS,
      )
      .map(({ period }) => period)
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort((a, b) => periodStart(b) - periodStart(a))
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
