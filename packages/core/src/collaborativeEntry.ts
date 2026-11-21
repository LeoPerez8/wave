/**
 * A Library song's entry in a collaborative playlist (docs/spec.md,
 * "Collaborative playlists", Library songs): the fields it carries so the
 * other members' devices can find it in their own Libraries, and the rule by
 * which a device matches it to one of its Tracks.
 */

import { UNKNOWN_ALBUM, UNKNOWN_ARTIST } from "./library.ts";
import type { UnsearchedEntry } from "./playlistEntries.ts";
import { normalizeSearchText } from "./search.ts";
import { libraryMatches, type YtSong } from "./ytMusic.ts";

/**
 * What a Library song's entry carries besides its recording key, under the
 * names the entry has on the wire (`SyncPlaylistEntry`). No cover. Each is
 * null when the song doesn't have it, or the entry came from an app from
 * before these fields.
 */
export interface LibraryEntryFields {
  readonly title: string | null;
  /** The artist credit, as the Track shows it ("A feat. B"). */
  readonly credit: string | null;
  readonly album: string | null;
  /** The length in ms. */
  readonly durationMs: number | null;
  /** The YouTube video id, when the song has one. */
  readonly videoId: string | null;
}

/** A Track as the match reads it. */
export interface EntryTrack {
  readonly recordingKey: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  /** 0 when the file's length couldn't be read. */
  readonly durationMs: number;
  readonly videoId: string | null;
}

/** A length in ms, or null when unknown (null, or 0 for a file whose length couldn't be read). */
const knownLength = (ms: number | null): number | null => (ms === null || ms <= 0 ? null : ms);

/**
 * The fields [track]'s entry carries in a collaborative playlist: what
 * converting a playlist, or adding the Track to a collaborative one, writes.
 * A credit or album the file doesn't give, and a length it couldn't read, are null.
 */
export const libraryEntryFields = (track: EntryTrack): LibraryEntryFields => ({
  title: track.title,
  credit: track.artist === UNKNOWN_ARTIST || track.artist === "" ? null : track.artist,
  album: track.album === UNKNOWN_ALBUM || track.album === "" ? null : track.album,
  durationMs: knownLength(track.durationMs),
  videoId: track.videoId,
});

/** A Library entry as the match reads it: its recording key ([songId]) and its fields. */
export interface CollaborativeLibraryEntry extends LibraryEntryFields {
  readonly songId: string;
}

/**
 * What a device plays for a Library entry: one of its Tracks, else the song
 * streamed from YT Music by its video id, else an unsearched entry searched
 * as it is about to play.
 */
export type CollaborativeEntryMatch<T> =
  | { readonly source: "library"; readonly track: T }
  | { readonly source: "stream"; readonly song: YtSong }
  | UnsearchedEntry;

/** Lengths this close are one recording, as `recordingMatches` takes them. */
const SAME_LENGTH_MS = 3000;

const albumOf = (album: string | null): string =>
  album === null ? "" : normalizeSearchText(album);

/**
 * The one of [candidates] the entry is: the only one, else the only one on
 * the entry's album; null when none fits or more than one still does.
 */
const onlyOne = <T extends EntryTrack>(
  candidates: readonly T[],
  album: string | null,
): T | null => {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const entryAlbum = albumOf(album);
  if (entryAlbum === "") return null;
  const sameAlbum = candidates.filter((candidate) => albumOf(candidate.album) === entryAlbum);
  return sameAlbum.length === 1 ? (sameAlbum[0] ?? null) : null;
};

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

/**
 * A matcher over a device's [tracks]: what it plays for a Library entry of a
 * collaborative playlist. The entry is the Track with its recording key, then
 * the Track with its video id, then the Track with its title, an artist they
 * share and a length within 3 seconds, both lengths known (`recordingMatches`).
 * The first step that finds a Track decides: when it finds several, the one
 * on the entry's album is the entry, and when that leaves none or more than
 * one, the entry matches no Track rather than a guess. An unmatched entry
 * streams by its video id, or is an unsearched entry without one; null when
 * it carries no title to show (an entry from an app from before its fields).
 */
export const collaborativeEntryMatcher = <T extends EntryTrack>(
  tracks: readonly T[],
): ((entry: CollaborativeLibraryEntry) => CollaborativeEntryMatch<T> | null) => {
  const byKey = new Map<string, T[]>();
  const byVideoId = new Map<string, T[]>();
  for (const track of tracks) {
    push(byKey, track.recordingKey, track);
    if (track.videoId !== null) push(byVideoId, track.videoId, track);
  }
  const byTags = libraryMatches(tracks);
  const candidateSteps = function* (entry: CollaborativeLibraryEntry): Generator<readonly T[]> {
    yield byKey.get(entry.songId) ?? [];
    if (entry.videoId !== null) yield byVideoId.get(entry.videoId) ?? [];
    const length = knownLength(entry.durationMs);
    if (entry.title === null || entry.credit === null || length === null) return;
    yield byTags({ title: entry.title, artists: [entry.credit], durationMs: length }).filter(
      (track) => {
        const trackLength = knownLength(track.durationMs);
        return trackLength !== null && Math.abs(trackLength - length) <= SAME_LENGTH_MS;
      },
    );
  };
  return (entry) => {
    for (const candidates of candidateSteps(entry)) {
      if (candidates.length === 0) continue;
      const track = onlyOne(candidates, entry.album);
      if (track !== null) return { source: "library", track };
      break;
    }
    if (entry.title === null) return null;
    const song = {
      title: entry.title,
      artists: entry.credit === null ? [] : [entry.credit],
      album: entry.album,
      durationMs: knownLength(entry.durationMs),
      artworkUrl: null,
    };
    return entry.videoId === null
      ? { source: "unsearched", song }
      : { source: "stream", song: { videoId: entry.videoId, ...song, explicit: false } };
  };
};
