import { finishSteps } from "./buildSteps.ts";
import { sortSteps } from "./buildSteps.ts";
/**
 * The songs the owner knows, as Home's mixes see them (docs/spec.md, "Artist
 * mixes", "Genre mixes"): a mix's new songs are radio songs the owner doesn't
 * know, and its familiar share is songs the owner does. The owner knows the
 * Library's songs, the songs ever played (recording keys, so a song played
 * and deleted since counts), the YT Music songs streamed and the songs in any
 * playlist. Built once per build (`mixKnownSongs`) and shared by every
 * section's mixes.
 */

import { playedFinderSteps } from "./discoverMixes.ts";
import type { PlaylistSong } from "./playlistEntries.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { libraryFinderSteps, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/**
 * A YT Music song the owner streamed before streamed plays were recorded: the
 * old per-video counter (`streamed_songs`). That history isn't imported, so
 * it only says the song is known.
 */
export interface StreamedSong {
  readonly song: YtAlbumSong;
  /** How many times it was streamed. */
  readonly plays: number;
  /** When it was first streamed (ms since the epoch). */
  readonly firstPlayedAt: number;
}

/** A YT Music song's recorded plays: one video under one recording key (`streamed_totals`). */
export interface StreamedPlays {
  readonly song: YtAlbumSong;
  /** Core's `recordingKey` of its plays, null when they have none. */
  readonly recordingKey: string | null;
  /** How many times it was streamed, counted or not. */
  readonly plays: number;
  /** When it was first streamed (ms since the epoch). */
  readonly firstPlayedAt: number;
}

/** A playlist entry that isn't a Library song, with when it was added. */
export interface MixPlaylistEntry {
  readonly song: Exclude<PlaylistSong<YtAlbumSong>, { readonly source: "library" }>;
  /** When it was added to its playlist (ms since the epoch). */
  readonly addedAt: number;
}

/** What the owner knows, read once per build. */
export interface MixKnownSources<L extends LibrarySongKey> {
  /** The Library's songs. */
  readonly library: readonly L[];
  /** The recording key (Core's `recordingKey`) of every song ever played. */
  readonly playedRecordingKeys: readonly string[];
  /** The old per-video counter, from before streamed plays were recorded. */
  readonly streamed: readonly StreamedSong[];
  /** The songs streamed since, from the play history: one per video and recording key. */
  readonly streamedPlays?: readonly StreamedPlays[];
  /** The playlists' entries other than Library songs (those are the Library's). */
  readonly playlisted: readonly MixPlaylistEntry[];
}

/** A song the owner knows that the phone has no file for, and that streams. */
export interface KnownNonDSong {
  readonly song: YtAlbumSong;
  /** How many times the owner streamed it. */
  readonly plays: number;
  /** When it became known: first streamed or added to a playlist, the latest of them. */
  readonly addedAt: number;
}

/** The songs the owner knows (`mixKnownSongs`). */
export interface MixKnownSongs<L extends LibrarySongKey> {
  /** The Library song a YT Music song is (`libraryFinder`), or null. */
  readonly inLibrary: (song: Pick<YtSong, "title" | "artists" | "durationMs">) => L | null;
  /** Whether the owner knows [song]: never one of a mix's new songs. */
  readonly known: (song: YtSong) => boolean;
  /**
   * The streamed and playlisted songs the Library doesn't have, each once
   * (by video), that can stream: the most streamed first, then the newest.
   * Unsearched and unavailable entries, and songs only played (no video),
   * aren't among them.
   */
  readonly nonD: readonly KnownNonDSong[];
}

/** A non-D song as the Library finder matches it (title, artists, length). */
const asLibraryKey = (song: {
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
}): LibrarySongKey => ({
  title: song.title,
  artist: song.artists.join(", "),
  durationMs: song.durationMs ?? 0,
});

/**
 * The songs the owner knows, from [sources]: the Library's (by
 * `libraryFinder`), the songs played (`playedFinder`), the songs streamed and
 * the YT Music entries of playlists (by video, or as the same recording),
 * and unsearched and unavailable entries (by title and artists, as the
 * Library finds a YT Music song).
 */
export const mixKnownSongs = <L extends LibrarySongKey>(
  sources: MixKnownSources<L>,
): MixKnownSongs<L> => finishSteps(mixKnownSongsSteps(sources));

export function* mixKnownSongsSteps<L extends LibrarySongKey>(
  sources: MixKnownSources<L>,
): Generator<void, MixKnownSongs<L>> {
  const inLibrary = yield* libraryFinderSteps(sources.library);
  const playedKeys = [...sources.playedRecordingKeys];
  for (const streamed of sources.streamedPlays ?? []) {
    if (streamed.recordingKey !== null) playedKeys.push(streamed.recordingKey);
    yield;
  }
  const played = yield* playedFinderSteps(playedKeys);
  const byVideo = new Map<string, { song: YtAlbumSong; plays: number; addedAt: number }>();
  const keys: LibrarySongKey[] = [];
  const note = (song: YtAlbumSong, plays: number, addedAt: number): void => {
    const before = byVideo.get(song.videoId);
    byVideo.set(song.videoId, {
      song: before?.song ?? song,
      plays: (before?.plays ?? 0) + plays,
      addedAt: Math.max(before?.addedAt ?? addedAt, addedAt),
    });
  };
  for (const streamed of [...sources.streamed, ...(sources.streamedPlays ?? [])]) {
    note(streamed.song, streamed.plays, streamed.firstPlayedAt);
    yield;
  }
  for (const entry of sources.playlisted) {
    yield;
    if (entry.song.source === "stream") note(entry.song.song, 0, entry.addedAt);
    else keys.push(asLibraryKey(entry.song.song));
  }
  for (const { song } of byVideo.values()) {
    keys.push(asLibraryKey(song));
    yield;
  }
  const nonDFinder = yield* libraryFinderSteps(keys);
  const candidates: KnownNonDSong[] = [];
  for (const entry of byVideo.values()) {
    if (inLibrary(entry.song) === null) candidates.push(entry);
    yield;
  }
  const nonD = yield* sortSteps(candidates, (a, b) => b.plays - a.plays || b.addedAt - a.addedAt);
  return {
    inLibrary,
    known: (song) =>
      byVideo.has(song.videoId) ||
      inLibrary(song) !== null ||
      played(song) ||
      nonDFinder(song) !== null,
    nonD,
  };
}
