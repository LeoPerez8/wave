/**
 * Recaps: a Wrapped-style look back at one calendar period of listening, in
 * the phone's local time, from counted plays (see `isCountedPlay`). This
 * module decides which periods have a Recap, the window each covers, what a
 * Recap holds and the slides it shows, in order.
 */
import { songFamilies, type GenreFamily } from "./genreMixes.ts";
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
/** How many artists a Recap's top artists list. */
export const RECAP_TOP_ARTISTS = 5;
/** How many genre families a Recap's top genres list. */
export const RECAP_TOP_GENRES = 5;

/** What a Recap is computed from. */
export interface RecapInput {
  readonly period: RecapPeriod;
  /** Counted listening over any span: only what started within the period counts. */
  readonly listening: readonly CountedListening[];
  /** Each song's counted plays within the period (`recapWindow`), in no order. */
  readonly songs: readonly PlayTotals[];
  /** Each artist's counted plays within the period, credited by track artist (`artistPlayTotals`). */
  readonly artists?: readonly PlayTotals[];
  /** Each album's counted plays within the period (`albumPlayTotals`). */
  readonly albums?: readonly PlayTotals[];
  /** The genre tags of `songs` (by id); a song not listed, or with no genre, is left out of the genres. */
  readonly songGenres?: readonly RecapSongGenre[];
  /**
   * When each of `artists` had their first counted play ever (any period); an
   * artist not listed isn't counted as discovered.
   */
  readonly artistFirstPlays?: readonly { readonly id: number; readonly firstPlayAt: number }[];
}

/** A song's genre tag: its first value and, for a multi-value tag, every value. */
export interface RecapSongGenre {
  readonly id: number;
  readonly genre: string | null;
  readonly genres?: readonly string[] | null;
}

/** A genre family among a Recap's top genres. */
export interface RecapGenre {
  readonly family: GenreFamily;
  /** Its share (0 to 1) of the counted plays of the period's songs with a genre. */
  readonly share: number;
}

/** One period's Recap. */
export interface Recap {
  readonly period: RecapPeriod;
  readonly title: string;
  /** Whole minutes of counted listening in the period. */
  readonly minutesListened: number;
  /** The period's most played songs, the top one first, as `rankPlays` orders them. */
  readonly topSongs: readonly PlayTotals[];
  /** The period's most played artists, the top one first. */
  readonly topArtists: readonly PlayTotals[];
  /** The period's most played album; null with none played. */
  readonly topAlbum: PlayTotals | null;
  /** The period's most played genre families, the top one first. */
  readonly topGenres: readonly RecapGenre[];
  /** When and how steadily the period was listened to; null with no counted listening. */
  readonly habits: RecapHabits | null;
  /** The artists whose first counted play ever was in the period, the most played first. */
  readonly discoveredArtists: readonly PlayTotals[];
}

/** A Recap's listening habits, in local time. */
export interface RecapHabits {
  /** The hour of day (0 to 23) with the most counted listening; the earliest on a tie. */
  readonly peakHour: number;
  /** The weekday (0 Sunday to 6 Saturday) with the most counted listening; the earliest on a tie. */
  readonly peakWeekday: number;
  /** The longest run of consecutive days with a counted play, within the period. */
  readonly longestStreakDays: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The index of the bucket with the most, the first on a tie. */
const peak = (sums: readonly number[]): number =>
  sums.reduce((best, sum, index) => (sum > sums[best]! ? index : best), 0);

/** `listening`'s habits (all of it within one period), or null for none. */
const habitsOf = (listening: readonly CountedListening[]): RecapHabits | null => {
  if (listening.length === 0) return null;
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  const days = new Set<number>();
  for (const { startedAt, listenedMs } of listening) {
    const date = new Date(startedAt);
    hours[date.getHours()]! += listenedMs;
    weekdays[date.getDay()]! += listenedMs;
    // A day number from the local date, so a DST change doesn't break a run.
    days.add(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  const ordered = [...days].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  ordered.forEach((day, index) => {
    run = index > 0 && day === ordered[index - 1]! + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return { peakHour: peak(hours), peakWeekday: peak(weekdays), longestStreakDays: longest };
};

/**
 * The genre families `songs` were played in, by counted plays (Genre mixes'
 * families: a song in n families adds 1/n of its plays to each), then by name.
 */
const topGenres = (
  songs: readonly PlayTotals[],
  songGenres: readonly RecapSongGenre[],
): RecapGenre[] => {
  const tags = new Map(songGenres.map((tagged) => [tagged.id, tagged]));
  const families = new Map<string, { family: GenreFamily; plays: number }>();
  let total = 0;
  for (const played of songs) {
    const tagged = tags.get(played.id);
    if (tagged === undefined || played.countedPlays <= 0) continue;
    const ofSong = songFamilies(tagged);
    if (ofSong.length === 0) continue;
    total += played.countedPlays;
    for (const family of ofSong) {
      const entry = families.get(family.key) ?? { family, plays: 0 };
      entry.plays += played.countedPlays / ofSong.length;
      families.set(family.key, entry);
    }
  }
  return (
    [...families.values()]
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort(
        (a, b) =>
          b.plays - a.plays ||
          (a.family.name < b.family.name ? -1 : a.family.name > b.family.name ? 1 : 0),
      )
      .slice(0, RECAP_TOP_GENRES)
      .map(({ family, plays }) => ({ family, share: plays / total }))
  );
};

/** `period`'s Recap from its plays. */
export const recap = ({
  period,
  listening,
  songs,
  artists = [],
  albums = [],
  songGenres = [],
  artistFirstPlays = [],
}: RecapInput): Recap => {
  const from = periodStart(period);
  const end = periodEnd(period);
  const within = listening.filter(
    (entry) => entry.startedAt >= from && entry.startedAt < end && entry.listenedMs > 0,
  );
  const listenedMs = within.reduce((sum, entry) => sum + entry.listenedMs, 0);
  const discovered = new Set(
    artistFirstPlays
      .filter((first) => first.firstPlayAt >= from && first.firstPlayAt < end)
      .map((first) => first.id),
  );
  return {
    period,
    title: recapTitle(period),
    minutesListened: Math.floor(listenedMs / MINUTE_MS),
    topSongs: rankPlays(songs, RECAP_TOP_SONGS),
    topArtists: rankPlays(artists, RECAP_TOP_ARTISTS),
    topAlbum: rankPlays(albums, 1)[0] ?? null,
    topGenres: topGenres(songs, songGenres),
    habits: habitsOf(within),
    discoveredArtists: rankPlays(
      artists.filter((artist) => discovered.has(artist.id)),
      Number.POSITIVE_INFINITY,
    ),
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

/** One slide of a Recap's stories. Each kind carries what it shows. */
export type RecapSlide =
  | { readonly kind: "minutes"; readonly minutes: number }
  | {
      readonly kind: "topSongs";
      /** The top songs, the top one first: it's the one highlighted. */
      readonly songs: readonly PlayTotals[];
    }
  | { readonly kind: "topArtists"; readonly artists: readonly PlayTotals[] }
  | { readonly kind: "topAlbum"; readonly album: PlayTotals }
  | { readonly kind: "topGenres"; readonly genres: readonly RecapGenre[] }
  | ({ readonly kind: "habits" } & RecapHabits)
  | {
      readonly kind: "discovered";
      /** Every artist discovered in the period, the most played first. */
      readonly artists: readonly PlayTotals[];
    }
  | {
      /** The summary card, always last: the Recap on one slide, as Wrapped's is. */
      readonly kind: "summary";
      readonly minutes: number;
      /** The top songs (up to 5), the top one first. */
      readonly songs: readonly PlayTotals[];
      /** The top artists (up to 5), the top one first. */
      readonly artists: readonly PlayTotals[];
      /** The top genre family; null with no song with a genre. */
      readonly genre: GenreFamily | null;
    };

/**
 * A Recap's slides, in the order the stories play them: minutes, top songs,
 * top artists, top album, top genres, habits, discovered artists, then the
 * summary card. A slide with nothing to show is left out; the summary card
 * always closes the stories.
 */
export const recapSlides = (shown: Recap): RecapSlide[] => {
  const slides: RecapSlide[] = [{ kind: "minutes", minutes: shown.minutesListened }];
  if (shown.topSongs.length > 0) slides.push({ kind: "topSongs", songs: shown.topSongs });
  if (shown.topArtists.length > 0) slides.push({ kind: "topArtists", artists: shown.topArtists });
  if (shown.topAlbum !== null) slides.push({ kind: "topAlbum", album: shown.topAlbum });
  if (shown.topGenres.length > 0) slides.push({ kind: "topGenres", genres: shown.topGenres });
  if (shown.habits !== null) slides.push({ kind: "habits", ...shown.habits });
  if (shown.discoveredArtists.length > 0) {
    slides.push({ kind: "discovered", artists: shown.discoveredArtists });
  }
  slides.push({
    kind: "summary",
    minutes: shown.minutesListened,
    songs: shown.topSongs,
    artists: shown.topArtists,
    genre: shown.topGenres[0]?.family ?? null,
  });
  return slides;
};

/** A habit's peak hour (0 to 23) on a 12-hour clock: "10 PM". */
export const recapHourLabel = (hour: number): string =>
  `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A habit's peak weekday (0 Sunday to 6 Saturday), as a habit says it: "Fridays". */
export const recapWeekdayLabel = (weekday: number): string => `${WEEKDAYS[weekday]}s`;

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
