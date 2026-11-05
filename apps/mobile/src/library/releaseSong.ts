import {
  joinArtists,
  releaseAnswerKey,
  releaseShownDate,
  typedReleaseDateOf,
  type ReleaseAnswer,
  type ReleaseDate,
  type ReleaseKeySong,
} from "@wave/core";

import type { PlaylistEntryRow, SongRow } from "./LibraryStore";
import { releaseAnswers } from "./releaseAnswers";
import { typedReleaseDates } from "./typedReleaseDates";

/**
 * A song as its release date and a playlist's sorts read it, whatever kind it is: a Library
 * song ([trackId]), or a YT Music or unsearched one, by its own title, artists as one credit
 * (Core's `joinArtists`, as a download of it is credited) and album.
 */
export interface ReleaseDateSong extends ReleaseKeySong {
  readonly album: string | null;
  /** The Library song, whose index and file take a typed date too; null for a streamed song. */
  readonly trackId: number | null;
  /** The original-date tag, as the index has it. */
  readonly original: ReleaseDate | null;
  readonly year: number | null;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  /** Its length, which a recording the lookup finds by title must be near; null when unknown. */
  readonly durationMs: number | null;
}

/** A Library song as release dates take it. */
export const libraryReleaseSong = (song: SongRow): ReleaseDateSong => ({
  title: song.title,
  artist: song.artist,
  album: song.album,
  trackId: song.id,
  original: song.releaseDate ?? null,
  year: song.year,
  discNumber: song.discNumber,
  trackNumber: song.trackNumber,
  durationMs: song.durationMs || null,
});

/**
 * A YT Music or unsearched song as release dates take it, by its own title, artists and album,
 * as its playlist entry is dated; [track], the Library's song it is by now, takes a typed date
 * too.
 */
export const streamedReleaseSong = (
  song: {
    readonly title: string;
    readonly artists: readonly string[];
    readonly album?: string | null;
    readonly durationMs?: number | null;
  },
  track: SongRow | null = null,
): ReleaseDateSong => ({
  title: song.title,
  artist: joinArtists(song.artists),
  album: song.album ?? null,
  trackId: track?.id ?? null,
  original: track?.releaseDate ?? null,
  year: track?.year ?? null,
  discNumber: track?.discNumber ?? null,
  trackNumber: track?.trackNumber ?? null,
  durationMs: song.durationMs || track?.durationMs || null,
});

/** A playlist entry's song as release dates and the playlist's sorts take it. */
export const entryReleaseSong = (entry: PlaylistEntryRow): ReleaseDateSong =>
  entry.source === "library" ? libraryReleaseSong(entry.track) : streamedReleaseSong(entry.song);

/**
 * The date [song] shows and sorts by (Core's `releaseShownDate`). [answers] and [typed] default
 * to the stored ones; a memo passes the values it re-renders on.
 */
export const releaseSongDate = (
  song: ReleaseDateSong,
  answers: Readonly<Record<string, ReleaseAnswer>> = releaseAnswers.get(),
  typed: Readonly<Record<string, string>> = typedReleaseDates.get(),
): ReleaseDate | null =>
  releaseShownDate({
    typed: typedReleaseDateOf(typed, song),
    original: song.original,
    answer: answers[releaseAnswerKey(song)],
    year: song.year,
  });

/** The date [song] holds that no lookup replaces: one the owner typed, or its original-date tag. */
export const heldReleaseDate = (song: ReleaseDateSong): ReleaseDate | null =>
  typedReleaseDateOf(typedReleaseDates.get(), song) ?? song.original;
