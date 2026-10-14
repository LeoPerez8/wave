/**
 * Listening totals over all time: minutes listened, songs listened and plays,
 * for the whole history (Home's listening overview) or one artist's songs
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
  let plays = 0;
  let lastPlayedAt: number | null = null;
  for (const song of songs) {
    if (filter.artistId !== undefined && !song.artistIds.includes(filter.artistId)) continue;
    listenedMs += song.listenedMs;
    plays += song.countedPlays;
    if (song.inLibrary && song.countedPlays > 0) songsListened += 1;
    lastPlayedAt = Math.max(lastPlayedAt ?? song.lastPlayedAt, song.lastPlayedAt);
  }
  return {
    minutesListened: Math.floor(listenedMs / MINUTE_MS),
    songsListened,
    plays,
    lastPlayedAt,
  };
};

/** The library totals the overview shows, as Library's Songs, Albums and Artists count them. */
export interface LibraryTotals {
  readonly songs: number;
  readonly albums: number;
  readonly artists: number;
}

/** Home's listening overview: each total as it reads, e.g. "2,500 songs" or "1 play". */
export interface ListeningOverview {
  /** Songs, albums, artists. */
  readonly library: readonly string[];
  /** Minutes listened, songs listened, plays. */
  readonly listening: readonly string[];
}

/**
 * `count` with thousands separators, then the singular for one and the plural
 * otherwise ("1 song", "12,500 songs"); the plural defaults to the singular + "s".
 */
export const counted = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString("en")} ${count === 1 ? singular : plural}`;

/** The overview's lines, in the order they read. */
export const listeningOverview = (
  library: LibraryTotals,
  listening: ListeningTotals,
): ListeningOverview => ({
  library: [
    counted(library.songs, "song", "songs"),
    counted(library.albums, "album", "albums"),
    counted(library.artists, "artist", "artists"),
  ],
  listening: [
    counted(listening.minutesListened, "minute listened", "minutes listened"),
    counted(listening.songsListened, "song listened", "songs listened"),
    counted(listening.plays, "play", "plays"),
  ],
});
