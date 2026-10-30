import { en, type Catalogue } from "./catalogueEn.ts";
/**
 * Recaps: a Wrapped-style look back at one calendar period of listening, in
 * the phone's local time, from counted plays (see `isCountedPlay`). This
 * module decides which periods have a Recap, the window each covers, what a
 * Recap holds and the slides it shows, in order.
 */
import { songFamilies, type GenreFamily } from "./genreMixes.ts";
import {
  lyricCardFileName,
  LYRIC_CARD_FALLBACK,
  type LyricStoryBackground,
} from "./lyricsShare.ts";
import { rankEntityPlays, type EntityPlayTotals, type StatsWindow } from "./stats.ts";

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

/** `period` as a Recap's title in [strings]' language: "September 2026", or "2026" for the year. */
export const recapTitle = (period: RecapPeriod, strings: Catalogue = en): string =>
  strings.recap.title(period);

/**
 * A shared slide's PNG's file name, the Recap [title]'s (`recapTitle`):
 * `Wave - Recap <title> - <yyyyMMdd-HHmmss>.png`, local time, as a lyrics card's.
 */
export const recapCardFileName = (title: string, at: Date): string =>
  lyricCardFileName(`Recap ${title}`, at);

/**
 * The background of the Instagram story a shared slide goes to as a sticker:
 * the slide's [colour] top and bottom, so it sits on its own colour.
 */
export const recapStoryBackground = (colour: string): LyricStoryBackground => {
  const solid = /^#[\da-f]{6}$/i.test(colour) ? colour.toLowerCase() : LYRIC_CARD_FALLBACK;
  return { top: solid, bottom: solid };
};

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
  /**
   * Each song's counted plays within the period (`recapWindow`), in no order:
   * a Library song's by its id, its streamed plays included, and a streamed
   * song's the Library hasn't by its video id.
   */
  readonly songs: readonly EntityPlayTotals[];
  /**
   * Each artist's counted plays within the period, credited by track artist
   * (`artistPlayTotals`), streamed plays included: an artist the Library
   * hasn't by its online id.
   */
  readonly artists?: readonly EntityPlayTotals[];
  /** Each album's counted plays within the period (`albumPlayTotals`). */
  readonly albums?: readonly EntityPlayTotals[];
  /** The genre tags of `songs` (by id); a song not listed, or with no genre, is left out of the genres. */
  readonly songGenres?: readonly RecapSongGenre[];
  /**
   * When each of `artists` had their first counted play ever (any period); an
   * artist not listed isn't counted as discovered.
   */
  readonly artistFirstPlays?: readonly ArtistFirstPlay[];
}

/** When the artist [id] had their first counted play ever (ms since the epoch). */
export interface ArtistFirstPlay {
  readonly id: number | string;
  readonly firstPlayAt: number;
}

/** A song's genre tag: its first value and, for a multi-value tag, every value. */
export interface RecapSongGenre {
  readonly id: number | string;
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
  readonly topSongs: readonly EntityPlayTotals[];
  /** The period's most played artists, the top one first. */
  readonly topArtists: readonly EntityPlayTotals[];
  /** The period's most played album; null with none played. */
  readonly topAlbum: EntityPlayTotals | null;
  /** The period's most played genre families, the top one first. */
  readonly topGenres: readonly RecapGenre[];
  /** When and how steadily the period was listened to; null with no counted listening. */
  readonly habits: RecapHabits | null;
  /** The artists whose first counted play ever was in the period, the most played first. */
  readonly discoveredArtists: readonly EntityPlayTotals[];
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
 * Returns up to five shares over all known-genre plays, for Recap and Stats.
 * Numeric ids are Library songs; string ids are streamed video ids.
 */
export const genrePlayShares = (
  songs: readonly EntityPlayTotals[],
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
    topSongs: rankEntityPlays(songs, RECAP_TOP_SONGS),
    topArtists: rankEntityPlays(artists, RECAP_TOP_ARTISTS),
    topAlbum: rankEntityPlays(albums, 1)[0] ?? null,
    topGenres: genrePlayShares(songs, songGenres),
    habits: habitsOf(within),
    discoveredArtists: rankEntityPlays(
      artists.filter((artist) => discovered.has(artist.id)),
      Number.POSITIVE_INFINITY,
    ),
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

/** Incremental equivalent of availableRecaps; callers feed bounded listening pages. */
export const createRecapAvailability = () => {
  const sums = new Map<string, { period: RecapPeriod; listenedMs: number }>();
  const addPeriod = (period: RecapPeriod, listenedMs: number): void => {
    const id = recapId(period);
    const held = sums.get(id);
    sums.set(id, { period, listenedMs: (held?.listenedMs ?? 0) + listenedMs });
  };
  return {
    add(entry: CountedListening): void {
      const month = monthOf(entry.startedAt);
      addPeriod(month, entry.listenedMs);
      addPeriod({ kind: "year", year: month.year }, entry.listenedMs);
    },
    *finish(now: number): Generator<void, RecapPeriod[]> {
      let periods: RecapPeriod[] = [];
      for (const { period, listenedMs } of sums.values()) {
        if (periodOut(period) <= now && listenedMs >= minimumMs(period)) periods.push(period);
        yield;
      }
      // Stable merge sort yields per comparison/copy, even with many years of imported history.
      for (let width = 1; width < periods.length; width *= 2) {
        const sorted: RecapPeriod[] = [];
        for (let start = 0; start < periods.length; start += 2 * width) {
          const middle = Math.min(start + width, periods.length);
          const end = Math.min(start + 2 * width, periods.length);
          let left = start;
          let right = middle;
          while (left < middle || right < end) {
            sorted.push(
              right >= end || (left < middle && newestFirst(periods[left]!, periods[right]!) <= 0)
                ? periods[left++]!
                : periods[right++]!,
            );
            yield;
          }
        }
        periods = sorted;
      }
      return periods;
    },
  };
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

/** One slide of a Recap's stories. Each kind carries what it shows. */
export type RecapSlide =
  | { readonly kind: "minutes"; readonly minutes: number }
  | {
      readonly kind: "topSongs";
      /** The top songs, the top one first: it's the one highlighted. */
      readonly songs: readonly EntityPlayTotals[];
    }
  | { readonly kind: "topArtists"; readonly artists: readonly EntityPlayTotals[] }
  | { readonly kind: "topAlbum"; readonly album: EntityPlayTotals }
  | { readonly kind: "topGenres"; readonly genres: readonly RecapGenre[] }
  | ({ readonly kind: "habits" } & RecapHabits)
  | {
      readonly kind: "discovered";
      /** Every artist discovered in the period, the most played first. */
      readonly artists: readonly EntityPlayTotals[];
    }
  | {
      /** The summary card, always last: the Recap on one slide, as Wrapped's is. */
      readonly kind: "summary";
      readonly minutes: number;
      /** The top songs (up to 5), the top one first. */
      readonly songs: readonly EntityPlayTotals[];
      /** The top artists (up to 5), the top one first. */
      readonly artists: readonly EntityPlayTotals[];
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

/** A habit's peak hour (0 to 23) on a 12-hour clock: "10 PM" (the catalogue's `recap.hour`). */
export const recapHourLabel = (hour: number): string => en.recap.hour(hour);

/** A habit's peak weekday (0 Sunday to 6 Saturday), as a habit says it: "Fridays" (`recap.weekdays`). */
export const recapWeekdayLabel = (weekday: number): string => en.recap.weekdays[weekday]!;

/** How long a slide shows before the stories move on by themselves. */
export const RECAP_SLIDE_MS = 6000;

/** The slide after `index` of `count`, or null when the stories end and close. */
export const recapForward = (index: number, count: number): number | null =>
  index + 1 < count ? index + 1 : null;

/**
 * Where the stories go when slide `index` of `count` has shown for its time:
 * the next slide, or null on the last one, the summary card, which stays
 * until a tap, a swipe down or close ends the stories (as Wrapped's does).
 */
export const recapAutoForward = (index: number, count: number): number | null =>
  recapForward(index, count);

/** The slide before `index`; on the first slide, the first again (it restarts). */
export const recapBack = (index: number): number => Math.max(0, index - 1);

/**
 * How full progress bar `bar` is while slide `current` shows, `progress`
 * (0 to 1) of the way through: full for slides already seen, empty for those to come.
 */
export const recapBarFill = (bar: number, current: number, progress: number): number =>
  bar < current ? 1 : bar > current ? 0 : progress;
