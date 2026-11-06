/**
 * What leaves the Wave account when Tracks leave a recording key here
 * (docs/spec.md, "Wave account and sync" › Missing songs): removed from the
 * Library (Remove from Library, Delete), or retagged to another key. A
 * removal travels as tombstones, so other phones drop the same song and star
 * at their next pull. A removed song's playlist entries mostly stay, as the
 * entry a song without a file is (`leavingSongEntry`).
 */

import { UNKNOWN_ALBUM } from "./library.ts";
import type { UnsearchedEntry } from "./playlistEntries.ts";
import type { SyncRow } from "./sync.ts";
import type { SyncFavorite, SyncPlaylistEntry, SyncSong } from "./syncWire.ts";
import type { YtSong } from "./ytMusic.ts";

/** One Track leaving its recording key. */
export interface LeavingTrack {
  readonly recordingKey: string;
  /** Its star, when the account may hold one (starred, or unstarred since the last push). */
  readonly star: { readonly changedAt: number } | null;
  /**
   * The playlist entries that leave with it, by sync id: those the account
   * may hold of a removed Track whose entries leave too (a voice note a scan
   * skips, the Track a duplicate fix drops). A Track removed by Delete or
   * Remove from Library keeps its entries as songs without a file, and a
   * retagged one keeps them under its new key, so either passes none.
   */
  readonly entries: readonly { readonly id: string; readonly changedAt: number }[];
}

/** The tombstones `songsLeaving` stamps. */
export interface SongsLeaving {
  readonly songs: readonly SyncSong[];
  readonly favorites: readonly SyncFavorite[];
  readonly playlistEntries: readonly SyncPlaylistEntry[];
}

/**
 * The tombstones Tracks [leaving] their recording keys send up, each stamped
 * by this phone at [now], or just after the row's last change if that's
 * later. A song leaves the account when no Track [staying] on the phone has
 * its key and the [account] has it. Its star leaves when a leaving Track had
 * one and no Track staying with the key is starred (two Tracks with one key
 * are one song, with one star). The entries that leave with a Track always
 * leave: they were that Track's alone.
 */
export const songsLeaving = (input: {
  readonly leaving: readonly LeavingTrack[];
  /** The Tracks staying in the Library (a retagged one under its new key). */
  readonly staying: readonly { readonly recordingKey: string; readonly starred: boolean }[];
  /** The account's songs as the phone knows them (`SyncRow`s: tombstones included). */
  readonly account: readonly {
    readonly recordingKey: string;
    readonly changedAt: number;
    readonly deleted: boolean;
  }[];
  readonly now: number;
  readonly phoneId: string;
}): SongsLeaving => {
  const tombstone = (id: string, after: number): SyncRow & { readonly deleted: true } => ({
    id,
    changedAt: Math.max(input.now, after + 1),
    phoneId: input.phoneId,
    deleted: true,
  });
  const held = new Set(input.staying.map((track) => track.recordingKey));
  const starred = new Set(
    input.staying.filter((track) => track.starred).map((track) => track.recordingKey),
  );
  const account = new Map(input.account.map((song) => [song.recordingKey, song]));

  const songs = new Map<string, SyncSong>();
  const favorites = new Map<string, SyncFavorite>();
  const playlistEntries: SyncPlaylistEntry[] = [];
  for (const track of input.leaving) {
    const key = track.recordingKey;
    const song = account.get(key);
    if (!held.has(key) && song !== undefined && !song.deleted && !songs.has(key)) {
      songs.set(key, tombstone(key, song.changedAt));
    }
    if (track.star !== null && !starred.has(key)) {
      const later = favorites.get(key);
      if (later === undefined || later.changedAt <= track.star.changedAt) {
        favorites.set(key, tombstone(key, track.star.changedAt));
      }
    }
    for (const entry of track.entries) playlistEntries.push(tombstone(entry.id, entry.changedAt));
  }
  return { songs: [...songs.values()], favorites: [...favorites.values()], playlistEntries };
};

/** A Library song leaving the Library, as its playlist entries are kept (`leavingSongEntry`). */
export interface LeavingSong {
  /** The YouTube video id of a song downloaded from YouTube Music, else `null`. */
  readonly videoId: string | null;
  readonly title: string;
  /** Its artist credit, for a song whose credit wasn't split into artists. */
  readonly artist: string;
  readonly artists: readonly string[];
  readonly album: string;
  readonly durationMs: number;
  readonly explicit: boolean;
}

/**
 * What a playlist entry of [song] becomes when the song leaves the Library
 * (Delete, Remove from Library, a signed-out scan that no longer finds its
 * file): the entry a song without a file is, in the same place. A song
 * downloaded from YouTube Music becomes a YT Music entry of its video, which
 * streams; any other an unsearched entry, which Wave searches on YouTube
 * Music as it does a Spotify import's. Neither knows a cover.
 */
export const leavingSongEntry = (
  song: LeavingSong,
): { readonly source: "stream"; readonly song: YtSong } | UnsearchedEntry => {
  const listed = {
    title: song.title,
    artists: song.artists.length > 0 ? song.artists : [song.artist],
    album: song.album === UNKNOWN_ALBUM || song.album === "" ? null : song.album,
    durationMs: song.durationMs > 0 ? song.durationMs : null,
    artworkUrl: null,
  };
  return song.videoId === null
    ? { source: "unsearched", song: listed }
    : { source: "stream", song: { videoId: song.videoId, ...listed, explicit: song.explicit } };
};
