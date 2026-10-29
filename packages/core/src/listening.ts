import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { formatNumber } from "./formatting.ts";
/**
 * Listening totals over all time: minutes listened, songs listened and plays,
 * for the whole history (Home's Stats) or one artist's songs
 * (the artist page): a song counts for every artist its credit names, as in
 * Stats, so a collaboration counts for each of them. Which plays count is the
 * play event's `counted` flag, set by `isCountedPlay`.
 */

/** What the library sums up for one song over all its plays. */
export interface SongListening {
  readonly trackId: number;
  /**
   * Every artist the song's credit names that is in the library, kept once
   * the song leaves the library; empty for songs that left before Wave kept
   * their artists.
   */
  readonly artistIds: readonly number[];
  /** Whether the song is still in the library. */
  readonly inLibrary: boolean;
  /** Its counted plays. */
  readonly countedPlays: number;
  /** Time listened over every play, skipped and uncounted ones included. */
  readonly listenedMs: number;
  /** When its latest play (counted or not) started. */
  readonly lastPlayedAt: number;
}

/** All-time listening totals. */
export interface ListeningTotals {
  /** Whole minutes listened over every play, skipped and uncounted ones included. */
  readonly minutesListened: number;
  /** Distinct songs, still in the library, with at least one counted play. */
  readonly songsListened: number;
  /** Counted plays. */
  readonly plays: number;
  /** When the latest play (counted or not) started; null when nothing was played. */
  readonly lastPlayedAt: number | null;
}

/** Narrows the totals to the songs whose credit names one artist. */
export interface ListeningFilter {
  readonly artistId?: number;
}

const MINUTE_MS = 60_000;

/**
 * Listening summed over many songs: what the store keeps summed for the
 * whole history (Home's Stats reads these rather than every
 * song's listening), and what `listeningTotals` sums songs into.
 */
export interface ListeningSums {
  /** Time listened over every play, skipped and uncounted ones included. */
  readonly listenedMs: number;
  readonly countedPlays: number;
  /** Songs still in the library with at least one counted play. */
  readonly songsListened: number;
  /** When the latest play (counted or not) started; null when nothing was played. */
  readonly lastPlayedAt: number | null;
}

/** All-time totals from listening summed already: the same totals `listeningTotals` gives for those songs. */
export const summedListeningTotals = (sums: ListeningSums): ListeningTotals => ({
  minutesListened: Math.floor(sums.listenedMs / MINUTE_MS),
  songsListened: sums.songsListened,
  plays: sums.countedPlays,
  lastPlayedAt: sums.lastPlayedAt,
});

/**
 * Sums each song's listening into all-time totals. Unfiltered, the totals
 * cover the whole history: plays and minutes of songs since removed from the
 * library still count (they were listened to), but such songs aren't among
 * the songs listened. Filtered to an artist, only the songs crediting that
 * artist count, the same way; a collaboration counts in full for each of its
 * artists, and once unfiltered.
 */
export const listeningTotals = (
  songs: readonly SongListening[],
  filter: ListeningFilter = {},
): ListeningTotals => {
  let listenedMs = 0;
  let songsListened = 0;
  let countedPlays = 0;
  let lastPlayedAt: number | null = null;
  for (const song of songs) {
    if (filter.artistId !== undefined && !song.artistIds.includes(filter.artistId)) continue;
    listenedMs += song.listenedMs;
    countedPlays += song.countedPlays;
    if (song.inLibrary && song.countedPlays > 0) songsListened += 1;
    lastPlayedAt = Math.max(lastPlayedAt ?? song.lastPlayedAt, song.lastPlayedAt);
  }
  return summedListeningTotals({ listenedMs, countedPlays, songsListened, lastPlayedAt });
};

/** The library totals the Stats facts show, as Library's Songs, Albums and Artists count them. */
export interface LibraryTotals {
  readonly songs: number;
  readonly albums: number;
  readonly artists: number;
}

/** Home's Stats facts, with each label separate from its formatted value. */
export type StatsFacts = readonly {
  readonly label: string;
  readonly value: string;
}[];

/**
 * `count` with thousands separators, then the singular for one and the plural
 * otherwise ("1 song", "12,500 songs"); the plural defaults to the singular + "s".
 */
export const counted = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString("en")} ${count === 1 ? singular : plural}`;

/** Home's fact labels in display order, also used by the loading placeholder. */
export const STATS_FACT_LABELS = [
  "Time listened",
  "Plays",
  "Songs listened",
  "Songs",
  "Albums",
  "Artists",
] as const;

/** Home's facts, listening first and then the library. */
export const statsFacts = (library: LibraryTotals, listening: ListeningTotals, language: AppLanguage = "en"): StatsFacts => {
  const values: Record<(typeof STATS_FACT_LABELS)[number], string> = {
    "Time listened":
      listening.minutesListened < 60
        ? `${listening.minutesListened} min`
        : `${formatNumber(language, Math.floor(listening.minutesListened / 60))} h`,
    Plays: formatNumber(language, listening.plays),
    "Songs listened": formatNumber(language, listening.songsListened),
    Songs: formatNumber(language, library.songs),
    Albums: formatNumber(language, library.albums),
    Artists: formatNumber(language, library.artists),
  };
  return STATS_FACT_LABELS.map((label) => ({ label: catalogueOf(language).home.factLabels[STATS_FACT_LABELS.indexOf(label)]!, value: values[label] }));
};
