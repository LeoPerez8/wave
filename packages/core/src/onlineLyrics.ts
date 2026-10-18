/**
 * Lyrics found online for the Lyrics view (docs/spec.md, "Lyrics online"):
 * for a non-D song (one this phone has no audio file for), the search order
 * (LRCLIB, then YT Music's lyrics for its video), what is saved against its
 * video id, and when a remembered miss is searched again. Fetching and
 * saving live in the app.
 */

import { parseLyrics, type Lyrics } from "./lyrics.ts";
import { songLookup, type FoundLyrics, type SongLookup } from "./lyricsAndGenre.ts";
import { readUnsearchedTrackId } from "./playlistEntries.ts";
import { parseTrackId, type YtSong } from "./ytMusic.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long "No lyrics found" is remembered before the song is searched again. */
export const LYRICS_MISS_RETRY_MS = 7 * DAY_MS;

/** What a lyrics search for a song goes by. */
export interface LyricsSearchSong {
  /** What LRCLIB is asked by (Fix Song's `songLookup`); null for a song never looked up. */
  readonly lookup: SongLookup | null;
  /** The YouTube video its YT Music lyrics are read from, and found lyrics are saved against; null without one yet. */
  readonly videoId: string | null;
}

/** Where lyrics are searched, in this order. */
export type LyricsSource = "lrclib" | "ytMusic";

/** What the phone keeps of a song's lyrics search, by its video id: the lyrics found, or a miss. */
export type SavedLyrics =
  | { readonly kind: "found"; readonly lyrics: FoundLyrics }
  | { readonly kind: "miss"; readonly checkedAt: number };

/** One source's answer: the lyrics it has (null for none), or that it couldn't be asked (offline, an error). */
export type LyricsAnswer =
  { readonly ok: true; readonly lyrics: FoundLyrics | null } | { readonly ok: false };

/** Where a non-D song's lyrics stand. */
export type NonDLyrics =
  | { readonly kind: "searching"; readonly ask: LyricsSource }
  /** Lyrics to show, and what to save for the song's video (null: nothing new, or no video yet). */
  | { readonly kind: "lyrics"; readonly lyrics: Lyrics; readonly save: SavedLyrics | null }
  /** "No lyrics found", and the miss to remember (null: already remembered, or no video yet). */
  | { readonly kind: "notFound"; readonly save: SavedLyrics | null }
  /** A source couldn't be reached and none had them: it says so and offers Try again; nothing is remembered. */
  | { readonly kind: "failed" }
  /** Settings turned online lookups off: "No lyrics", with no request. */
  | { readonly kind: "off" };

export interface NonDLyricsState {
  /** What the phone keeps for the song's video; null for nothing (or no video). */
  readonly saved: SavedLyrics | null;
  /** The answers so far, in the order the sources were asked. */
  readonly answers: readonly LyricsAnswer[];
  /** Settings' "Fix songs online". */
  readonly lookupsOn: boolean;
  /** Settings' YT Music switch. */
  readonly ytMusicOn: boolean;
  readonly now: number;
}

/** What a streamed song's details say, as the queue keeps them. */
export type NonDSongDetails = Pick<YtSong, "title" | "artists" | "album" | "durationMs">;

const lookupOf = (details: NonDSongDetails): SongLookup | null =>
  songLookup({
    title: details.title,
    // The services credit features in the title, as for a download (`ytDownloadLookup`).
    artist: details.artists[0] ?? "",
    album: details.album ?? "",
    durationMs: details.durationMs ?? 0,
  });

/**
 * What the lyrics search for the queue's track [trackId] goes by, when it's
 * a non-D song: a YT Music song by its [details] and its video, an
 * unsearched one by what its listing says (its id holds it) with no video
 * yet. Null for a Library track, and for a YT Music song while its [details]
 * aren't known: its search waits for them, as YT Music asked alone would
 * save its plain lyrics (or a miss) before LRCLIB was ever asked.
 */
export const nonDLyricsSong = (
  trackId: string,
  details: NonDSongDetails | null,
): LyricsSearchSong | null => {
  const unsearched = readUnsearchedTrackId(trackId);
  if (unsearched !== null) return { lookup: lookupOf(unsearched), videoId: null };
  const track = parseTrackId(trackId);
  if (track?.kind !== "yt") return null;
  return details === null ? null : { lookup: lookupOf(details), videoId: track.videoId };
};

/** YT Music's lyrics for a video ([text], plain) as found lyrics: Unix line ends, no blank edges; null when blank. */
export const ytMusicFoundLyrics = (text: string | null): FoundLyrics | null => {
  const tidy = text?.replace(/\r\n?/g, "\n").trim() ?? "";
  return tidy === "" ? null : { synced: false, text: tidy };
};

/** [found]'s lyrics to show, or null when they have no words (only LRC header tags). */
const shown = (found: FoundLyrics | null): Lyrics | null => {
  if (found === null) return null;
  const lyrics = parseLyrics(found.text);
  return lyrics.kind === "none" ? null : lyrics;
};

/**
 * The sources [song] is searched in, in order: LRCLIB (when it can be looked
 * up), then YT Music's lyrics for its video (while YT Music is on).
 */
const lyricsSources = (song: LyricsSearchSong, ytMusicOn: boolean): LyricsSource[] => [
  ...(song.lookup === null ? [] : (["lrclib"] as const)),
  ...(song.videoId === null || !ytMusicOn ? [] : (["ytMusic"] as const)),
];

/** Whether a miss checked at [checkedAt] still stands at [now] (it's searched again after a week). */
export const missStands = (checkedAt: number, now: number): boolean =>
  now - checkedAt < LYRICS_MISS_RETRY_MS;

/** Where an online search for a song's lyrics stands, given the answers so far. */
export type LyricsSearch =
  | { readonly kind: "searching"; readonly ask: LyricsSource }
  | { readonly kind: "found"; readonly found: FoundLyrics; readonly lyrics: Lyrics }
  /** No source had them. */
  | { readonly kind: "miss" }
  /** A source couldn't be reached and none had them. */
  | { readonly kind: "failed" };

/**
 * The search for [song]'s lyrics given the [answers] so far: the source to
 * ask next (LRCLIB, then YT Music's lyrics for its video), the first lyrics
 * found, or none. Shared by the non-D and Library searches.
 */
export const lyricsSearch = (
  song: LyricsSearchSong,
  answers: readonly LyricsAnswer[],
  ytMusicOn: boolean,
): LyricsSearch => {
  const sources = lyricsSources(song, ytMusicOn);
  for (const [at, source] of sources.entries()) {
    const answer = answers[at];
    if (answer === undefined) return { kind: "searching", ask: source };
    const lyrics = answer.ok ? shown(answer.lyrics) : null;
    if (answer.ok && answer.lyrics !== null && lyrics !== null) {
      return { kind: "found", found: answer.lyrics, lyrics };
    }
  }
  // A source that couldn't say might have them: not a miss.
  if (answers.some((answer) => !answer.ok)) return { kind: "failed" };
  return { kind: "miss" };
};

/**
 * Where [song]'s lyrics stand in the Lyrics view: the source to ask next
 * while it searches, the lyrics to show, or why there are none.
 */
export const nonDLyrics = (song: LyricsSearchSong, state: NonDLyricsState): NonDLyrics => {
  const { saved } = state;
  if (saved?.kind === "found") {
    return { kind: "lyrics", lyrics: parseLyrics(saved.lyrics.text), save: null };
  }
  if (!state.lookupsOn) return { kind: "off" };
  if (saved?.kind === "miss" && missStands(saved.checkedAt, state.now)) {
    return { kind: "notFound", save: null };
  }
  const search = lyricsSearch(song, state.answers, state.ytMusicOn);
  switch (search.kind) {
    case "searching":
    case "failed":
      return search;
    case "found":
      return {
        kind: "lyrics",
        lyrics: search.lyrics,
        save: song.videoId === null ? null : { kind: "found", lyrics: search.found },
      };
    case "miss":
      return {
        kind: "notFound",
        // A song no source could be asked about made no search to remember.
        save:
          song.videoId === null || state.answers.length === 0
            ? null
            : { kind: "miss", checkedAt: state.now },
      };
  }
};
