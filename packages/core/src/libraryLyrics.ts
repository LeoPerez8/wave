/**
 * Lyrics found online for a Library song whose file has none (docs/spec.md,
 * "Lyrics online"): the same search as a non-D song's (`onlineLyrics.ts`),
 * but a hit is written into the file and a miss is remembered for the track.
 * Fetching, writing and remembering live in the app.
 */

import type { Lyrics } from "./lyrics.ts";
import { songLookup, type FoundLyrics } from "./lyricsAndGenre.ts";
import {
  lyricsSearch,
  missStands,
  type LyricsAnswer,
  type LyricsSearchSong,
  type LyricsSource,
} from "./onlineLyrics.ts";

export interface LibraryLyricsState {
  /** What its file has, in its tags or a sidecar `.lrc` (Core's `pickLyrics`). */
  readonly file: Lyrics;
  /** When a search last found nothing for it; null for never. */
  readonly missedAt: number | null;
  /** The answers so far, in the order the sources were asked. */
  readonly answers: readonly LyricsAnswer[];
  /** Settings' "Fix songs online". */
  readonly lookupsOn: boolean;
  /** Settings' YT Music switch. */
  readonly ytMusicOn: boolean;
  readonly now: number;
}

/** Where a Library song's lyrics stand. */
export type LibraryLyrics =
  | { readonly kind: "searching"; readonly ask: LyricsSource }
  /** Lyrics to show, and what to write into its file (null: they came from it). */
  | { readonly kind: "lyrics"; readonly lyrics: Lyrics; readonly write: FoundLyrics | null }
  /**
   * Today's "No lyrics" (with its `.lrc` hint), and when to remember that
   * the search found nothing (null: nothing new to remember).
   */
  | { readonly kind: "none"; readonly remember: number | null }
  /** A source couldn't be reached and none had them: Try again; nothing is remembered. */
  | { readonly kind: "failed" };

const NO_LYRICS: LibraryLyrics = { kind: "none", remember: null };

/** What a Library song's index entry says, for its lyrics search. */
export interface LibraryLyricsTrack {
  readonly title: string;
  /** The artist credit, as Fix Song sends it. */
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  /** The YouTube video it was downloaded from; null for a song not from YT Music. */
  readonly videoId: string | null;
}

/**
 * What the lyrics search for a Library song goes by: LRCLIB is asked as Fix
 * Song asks it (`songLookup`), and YT Music only for a song downloaded from a
 * video.
 */
export const libraryLyricsSong = (track: LibraryLyricsTrack): LyricsSearchSong => ({
  lookup: songLookup(track),
  videoId: track.videoId,
});

/**
 * Where the Library song [song]'s lyrics stand in the Lyrics view: its
 * file's, or the source to ask next while it searches, the lyrics found, or
 * why there are none.
 */
export const libraryLyrics = (song: LyricsSearchSong, state: LibraryLyricsState): LibraryLyrics => {
  if (state.file.kind !== "none") return { kind: "lyrics", lyrics: state.file, write: null };
  if (!state.lookupsOn) return NO_LYRICS;
  if (state.missedAt !== null && missStands(state.missedAt, state.now)) return NO_LYRICS;
  const search = lyricsSearch(song, state.answers, state.ytMusicOn);
  switch (search.kind) {
    case "searching":
    case "failed":
      return search;
    case "found":
      return { kind: "lyrics", lyrics: search.lyrics, write: search.found };
    case "miss":
      // A song no source could be asked about made no search to remember.
      return state.answers.length === 0 ? NO_LYRICS : { kind: "none", remember: state.now };
  }
};
