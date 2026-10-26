/**
 * An artist page's stats block: the artist's all-time listening totals, as
 * `listeningTotals` sums them (over the songs whose credit names the artist,
 * as in Stats, so a collaboration counts for each of its artists), and their
 * most played songs, ranked by Stats' rule (`rankPlays`).
 */
import { counted, listeningTotals, type SongListening } from "./listening.ts";
import { rankPlays, type PlayTotals } from "./stats.ts";

/** What the artist page knows and reads for its stats block. */
export interface ArtistStatsInput {
  readonly artistId: number;
  /**
   * The songs in the library whose credit names the artist: the same songs
   * the listening counts for them, so "X of N songs" counts both over one set.
   */
  readonly songIds: readonly number[];
  /**
   * The all-time listening of at least every played song whose credit names
   * the artist, deleted songs included (the store reads just those); other
   * artists' songs are left out.
   */
  readonly listening: readonly SongListening[];
  /**
   * The all-time counted plays of at least every song in [songIds] that has
   * one (the store reads just those); other songs are left out.
   */
  readonly songPlays: readonly PlayTotals[];
  /** Unmatched streamed songs credited to this artist. Library coverage stays over Library songs. */
  readonly streamedListening?: readonly {
    readonly countedPlays: number;
    readonly listenedMs: number;
    readonly lastPlayedAt: number;
  }[];
  readonly now: number;
}

/** The stats block: not played yet, or each total as it reads and the most played songs. */
export type ArtistStats =
  | { readonly played: false }
  | {
      readonly played: true;
      /** "12 plays": counted plays of the artist's songs. */
      readonly plays: string;
      /** "48 minutes listened": every play, skipped and uncounted ones included. */
      readonly minutesListened: string;
      /** "34 of 120 songs": the songs crediting them with a counted play, out of all those songs. */
      readonly songsListened: string;
      /** "Last played 3 days ago": their latest play, counted or not. */
      readonly lastPlayed: string;
      /** Their most played songs (at most `ARTIST_MOST_PLAYED`), the top one first. */
      readonly mostPlayed: readonly PlayTotals[];
    };

/** How many of the artist's most played songs the artist page lists. */
export const ARTIST_MOST_PLAYED = 5;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long ago `at` was, from `now`: "just now", "5 minutes ago", "yesterday", "3 weeks ago"… */
const ago = (at: number, now: number): string => {
  const elapsed = Math.max(0, now - at);
  const units: readonly (readonly [number, string, string])[] = [
    [365 * DAY_MS, "year", "years"],
    [30 * DAY_MS, "month", "months"],
    [7 * DAY_MS, "week", "weeks"],
    [DAY_MS, "day", "days"],
    [HOUR_MS, "hour", "hours"],
    [MINUTE_MS, "minute", "minutes"],
  ];
  for (const [size, singular, plural] of units) {
    const count = Math.floor(elapsed / size);
    if (count === 0) continue;
    if (size === DAY_MS && count === 1) return "yesterday";
    return `${counted(count, singular, plural)} ago`;
  }
  return "just now";
};

/**
 * The artist's stats block. An artist none of whose songs has a counted play
 * is not played yet (rather than a row of zeros).
 */
export const artistStats = (input: ArtistStatsInput): ArtistStats => {
  const totals = { ...listeningTotals(input.listening, { artistId: input.artistId }) };
  let listenedMs = input.listening.reduce(
    (sum, song) => sum + (song.artistIds.includes(input.artistId) ? song.listenedMs : 0),
    0,
  );
  for (const stream of input.streamedListening ?? []) {
    totals.plays += stream.countedPlays;
    listenedMs += stream.listenedMs;
    totals.lastPlayedAt = Math.max(totals.lastPlayedAt ?? 0, stream.lastPlayedAt);
  }
  const minutesListened = Math.floor(listenedMs / MINUTE_MS);
  if (totals.plays === 0 || totals.lastPlayedAt === null) return { played: false };
  const songIds = new Set(input.songIds);
  const songCount = songIds.size;
  return {
    played: true,
    plays: counted(totals.plays, "play", "plays"),
    minutesListened: counted(minutesListened, "minute listened", "minutes listened"),
    songsListened: `${totals.songsListened.toLocaleString("en")} of ${counted(songCount, "song", "songs")}`,
    lastPlayed: `Last played ${ago(totals.lastPlayedAt, input.now)}`,
    mostPlayed: rankPlays(
      input.songPlays.filter((song) => songIds.has(song.id)),
      ARTIST_MOST_PLAYED,
    ),
  };
};
