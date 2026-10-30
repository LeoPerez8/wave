import { plural } from "../plural.ts";
import type { RecapPeriod } from "../recap.ts";

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

const WEEKDAYS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

const title = (period: RecapPeriod) =>
  period.kind === "month" ? `${MONTHS[period.month - 1]} ${period.year}` : String(period.year);

/** A habit's peak hour (0 to 23) on a 12-hour clock: "10 PM". */
const hour = (value: number) => `${value % 12 === 0 ? 12 : value % 12} ${value < 12 ? "AM" : "PM"}`;

const KINDS = { month: "Recap", year: "Year in music" } satisfies Record<
  RecapPeriod["kind"],
  string
>;

/** Recaps: their cards, stories and slides. */
export const recapEn = {
  /** A Recap's title: "September 2026", or "2026" for the year. */
  title,
  /** What a Recap of each kind is called, over its title on Stats. */
  kinds: KINDS,
  /** A Recap's tile on Stats, for TalkBack: "October 2026 Recap". */
  tileLabel: (period: RecapPeriod) => `${title(period)} ${KINDS[period.kind]}`,
  ready: {
    month: "Your Recap is ready",
    year: "Your year in music is ready",
  } satisfies Record<RecapPeriod["kind"], string>,
  tapToWatch: "Tap to watch",
  listenedIn: (period: RecapPeriod) => `In ${title(period)} you listened for`,
  minutes: (count: number) => plural("en", count, { one: "minute", other: "minutes" }),
  topSongs: "Your top songs",
  topArtists: "Your top artists",
  topAlbum: "Your top album",
  topGenres: "Your top genres",
  /** A genre's share of the plays: "#1 · 24% of your plays". */
  shareOfPlays: (percent: string) => `${percent} of your plays`,
  listenedMost: "You listened most",
  weekdays: WEEKDAYS,
  hour,
  /** The peak weekday (0 Sunday to 6 Saturday) as the habits slide says it: "on Fridays". */
  onWeekday: (weekday: number) => `on ${WEEKDAYS[weekday]}`,
  /** The peak hour (0 to 23) as the habits slide says it: "around 10 PM". */
  aroundHour: (value: number) => `around ${hour(value)}`,
  longestStreak: "Your longest streak",
  streakDays: (count: number) => plural("en", count, { one: "day", other: "days in a row" }),
  discovered: "You discovered",
  newArtists: (count: number) => plural("en", count, { one: "new artist", other: "new artists" }),
  summaryTopArtists: "Top artists",
  summaryTopSongs: "Top songs",
  minutesListened: "Minutes listened",
  topGenre: "Top genre",
  /** The stories' TalkBack label: "October 2026, slide 2 of 7". */
  slidePosition: (period: RecapPeriod, index: number, count: number) =>
    `${title(period)}, slide ${index} of ${count}`,
  recap: "Recap",
  paused: "Paused",
  playing: "Playing",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  resumeStories: "Resume stories",
  pauseStories: "Pause stories",
  shareSlide: "Share slide",
  close: "Close Recap",
  unavailable: "This Recap isn't available.",
  loading: "Loading Recap",
};
