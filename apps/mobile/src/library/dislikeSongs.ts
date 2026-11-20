import {
  dislikeSongs as dislikeChange,
  isDisliked,
  noMarkChanges,
  splitCredit,
  ytTrackId,
  type DislikedSong,
  type MarkChanges,
} from "@wave/core";

import type { SongRow } from "@wave/client";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { showDislikeToast } from "@/overlay/dislikeToast";
import type { FindInLibrary } from "@/ytmusic/libraryFinder";

import { dislikedSongsNow, forgetDislikes, keepDislikes, loadDislikes } from "./dislikes";
import { currentFavoriteIds, knownStarNow, ytSongStarredNow } from "./favorites";
import { starSongs, type SongsToStar } from "./starSongs";

/**
 * Dislike (docs/spec.md): a mark that keeps a song out of what Wave picks on
 * its own. Core's `dislikeSongs` decides what it changes (a disliked song is
 * no favorite) and what Undo puts back; this writes it, for the Library's
 * songs and YT Music's alike, kept by the identity favorites use: a YT Music
 * song the Library has by now is disliked as the Library's song.
 */

/** A song to dislike: as its dislike is kept, and as its star is set. */
interface Subject {
  readonly dislike: Omit<DislikedSong, "dislikedAt">;
  readonly track: SongRow | null;
  readonly ytSong: NativeYtSong | null;
}

const subjects = ({ tracks, ytSongs }: SongsToStar, find: FindInLibrary): Subject[] => {
  const byKey = new Map<string, Subject>();
  const addTrack = (track: SongRow): void => {
    const key = String(track.id);
    if (byKey.has(key)) return;
    byKey.set(key, {
      dislike: {
        key,
        title: track.title,
        artists: splitCredit(track.artist),
        durationMs: track.durationMs,
      },
      track,
      ytSong: null,
    });
  };
  for (const track of tracks) addTrack(track);
  for (const ytSong of ytSongs) {
    const track = find(ytSong);
    if (track !== null) {
      addTrack(track);
      continue;
    }
    const key = ytTrackId(ytSong.videoId);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      dislike: {
        key,
        title: ytSong.title,
        artists: ytSong.artists,
        durationMs: ytSong.durationMs,
      },
      track: null,
      ytSong,
    });
  }
  return [...byKey.values()];
};

/** The Library songs' stars, read from the store only when this phone doesn't know one yet. */
const starredTracks = async (songs: readonly Subject[]): Promise<(id: number) => boolean> => {
  const unknown = songs.some(({ track }) => track !== null && knownStarNow(track.id) === null);
  const read = unknown ? await currentFavoriteIds().catch(() => new Set<number>()) : null;
  return (id) => knownStarNow(id) ?? read?.has(id) ?? false;
};

/** Writes [changes]: the dislikes, and the stars they replace or put back (silently). */
const write = (changes: MarkChanges<Subject>, find: FindInLibrary): Promise<void> => {
  const stars = (songs: readonly Subject[]): SongsToStar => ({
    tracks: songs.flatMap(({ track }) => (track === null ? [] : [track])),
    ytSongs: songs.flatMap(({ ytSong }) => (ytSong === null ? [] : [ytSong])),
  });
  return Promise.all([
    forgetDislikes(changes.removeDislike.map((song) => song.dislike.key)),
    keepDislikes(changes.dislike.map((song) => song.dislike)),
    // Now Playing's source: the star changes without a toast of its own.
    changes.unfavorite.length === 0
      ? undefined
      : starSongs(stars(changes.unfavorite), false, find, "nowPlaying"),
    changes.favorite.length === 0
      ? undefined
      : starSongs(stars(changes.favorite), true, find, "nowPlaying"),
  ]).then(() => undefined);
};

/**
 * Dislikes ([on]) or removes the dislike of [songs], the Library's and YT
 * Music's ([find] says which YT Music songs the Library has). A dislike
 * unstars the song and is confirmed by a toast whose Undo puts back what was
 * there, the star included; removing one says nothing, as unstarring does.
 * Resolves once the changes are saved, so what follows a dislike (a skip)
 * runs after it.
 */
export const dislikeSongs = async (
  songs: SongsToStar,
  on: boolean,
  find: FindInLibrary,
): Promise<void> => {
  const targets = subjects(songs, find);
  if (targets.length === 0) return;
  await loadDislikes();
  const starred = await starredTracks(targets);
  const disliked = dislikedSongsNow();
  const { changes, undo } = dislikeChange(
    targets.map((song) => ({
      song,
      favorite:
        song.track !== null
          ? starred(song.track.id)
          : song.ytSong !== null && ytSongStarredNow(song.ytSong.videoId, null),
      disliked: disliked.has(song.dislike.key),
    })),
    on,
  );
  if (noMarkChanges(changes)) return;
  const saved = write(changes, find);
  showDislikeToast(on, changes.dislike.length, () => void write(undo, find));
  await saved;
};

/**
 * Whether a YT Music song shows disliked: by its video, or as [track], the
 * Library song it is by now (Core's `isDisliked`).
 */
export const ytSongDislikedNow = (
  videoId: string,
  track: { readonly id: number } | null,
): boolean => isDisliked(dislikedSongsNow(), { id: track?.id, videoId });
