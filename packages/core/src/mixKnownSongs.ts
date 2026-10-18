/**
 * The songs the owner knows, as Home's mixes see them (docs/spec.md, "Artist
 * mixes", "Genre mixes"): a mix's new songs are radio songs the owner doesn't
 * know, and its familiar share is songs the owner does. The owner knows the
 * Library's songs, the songs ever played (recording keys, so a song played
 * and deleted since counts), the YT Music songs streamed and the songs in any
 * playlist. Built once per build (`mixKnownSongs`) and shared by every
 * section's mixes.
 */

import { playedFinder } from "./discoverMixes.ts";
import type { PlaylistSong } from "./playlistEntries.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/** A YT Music song the owner streamed (streamed plays aren't play history). */
export interface StreamedSong {
  readonly song: YtAlbumSong;
  /** How many times it was streamed. */
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
  readonly streamed: readonly StreamedSong[];
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
): MixKnownSongs<L> => {
  const inLibrary = libraryFinder(sources.library);
  const played = playedFinder(sources.playedRecordingKeys);
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
  for (const streamed of sources.streamed)
    note(streamed.song, streamed.plays, streamed.firstPlayedAt);
  for (const entry of sources.playlisted) {
    if (entry.song.source === "stream") note(entry.song.song, 0, entry.addedAt);
    else keys.push(asLibraryKey(entry.song.song));
  }
  for (const { song } of byVideo.values()) keys.push(asLibraryKey(song));
  const nonDFinder = libraryFinder(keys);
  const nonD = [...byVideo.values()]
    .filter(({ song }) => inLibrary(song) === null)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
    .sort((a, b) => b.plays - a.plays || b.addedAt - a.addedAt);
  return {
    inLibrary,
    known: (song) =>
      byVideo.has(song.videoId) ||
      inLibrary(song) !== null ||
      played(song) ||
      nonDFinder(song) !== null,
    nonD,
  };
};
