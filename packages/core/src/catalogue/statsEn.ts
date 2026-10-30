import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { StatsPeriod } from "../stats.ts";
import type { StatsRanking } from "../statsSeeAll.ts";

/** A unit "ago" counts in, largest first. */
export type AgoUnit = "year" | "month" | "week" | "day" | "hour" | "minute";

const AGO_UNITS: Record<AgoUnit, readonly [string, string]> = {
  year: ["year", "years"],
  month: ["month", "months"],
  week: ["week", "weeks"],
  day: ["day", "days"],
  hour: ["hour", "hours"],
  minute: ["minute", "minutes"],
};

const plays = (count: number) =>
  plural("en", count, {
    one: `${formatNumber("en", count)} play`,
    other: `${formatNumber("en", count)} plays`,
  });

/** Stats, Home's Stats facts and an artist page's Stats block. */
export const statsEn = {
  genres: "Genres",
  genrePercent: (share: number) =>
    share < 0.01 ? "<1%" : `${formatNumber("en", Math.round(share * 1000) / 10)}%`,
  genreBlockLabel: (rank: number, name: string, percent: string) => `#${rank}, ${name}, ${percent}`,
  recaps: "Recaps",
  loadingListeningStats: "Loading listening stats",
  loadingRanking: "Loading ranking",
  /** Each ranking's title, on Stats and its See all page. */
  rankings: {
    songs: "Top songs",
    albums: "Top albums",
    artists: "Top artists",
  } satisfies Record<StatsRanking, string>,
  rankingGoneTitle: "Nothing here",
  rankingGoneMessage: "This ranking doesn't exist.",
  /** Each period's name, and its shorter one on the period selector, where four must fit across. */
  periods: {
    week: { label: "Last 7 days", tab: "7 days" },
    month: { label: "Last 30 days", tab: "30 days" },
    year: { label: "Last 12 months", tab: "12 months" },
    all: { label: "All time", tab: "All time" },
  } satisfies Record<StatsPeriod, { label: string; tab: string }>,
  noPlays: {
    week: "No plays in the last 7 days",
    month: "No plays in the last 30 days",
    year: "No plays in the last 12 months",
    all: "No plays yet",
  } satisfies Record<StatsPeriod, string>,
  countedHint: "Songs you listen to for more than 15 seconds are counted here.",
  plays,
  /** Home's Stats facts, listening first and then the library. */
  facts: {
    timeListened: "Time listened",
    plays: "Plays",
    songsListened: "Songs listened",
    songs: "Songs",
    albums: "Albums",
    artists: "Artists",
  },
  /** Opening an online album from a ranking or Home. */
  albumNotFound: "Album not found",
  albumNotFoundMessage: "This album couldn't be found online.",
  albumFailed: "Couldn't open album",
  albumFailedMessage: "Try again when you're online.",
  notPlayedYet: "Not played yet",
  mostPlayed: "Most played",
  minutesListened: (count: number) =>
    plural("en", count, {
      one: `${formatNumber("en", count)} minute listened`,
      other: `${formatNumber("en", count)} minutes listened`,
    }),
  /** How many of the artist's Library songs were listened to: "12 of 40 songs". */
  songsListened: (listened: number, total: number) =>
    plural("en", total, {
      one: `${formatNumber("en", listened)} of ${formatNumber("en", total)} song`,
      other: `${formatNumber("en", listened)} of ${formatNumber("en", total)} songs`,
    }),
  /** [ago] is `justNow`, `yesterday` or `ago`'s. */
  lastPlayed: (ago: string) => `Last played ${ago}`,
  justNow: "just now",
  yesterday: "yesterday",
  ago: (count: number, unit: AgoUnit) => {
    const [one, other] = AGO_UNITS[unit];
    return `${plural("en", count, { one: `${formatNumber("en", count)} ${one}`, other: `${formatNumber("en", count)} ${other}` })} ago`;
  },
};
