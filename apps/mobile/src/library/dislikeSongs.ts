import {
  currentEntry,
  dislikeKey,
  dislikeKeys,
  dislikeSkipsPlaying,
  dislikeSongs as dislikeChange,
  isDisliked,
  noMarkChanges,
  splitCredit,
  type DislikedSong,
  type MarkChanges,
  type SongIdentity,
} from "@wave/core";

import type { SongRow } from "@wave/client";
import { currentLocalisation } from "@/localisation/localisation";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { showError } from "@/overlay/alert";
import { showDislikeToast } from "@/overlay/dislikeToast";
import { skipToNext } from "@/playback/actions";
import { queueState } from "@/playback/Queue";
import type { FindInLibrary } from "@/ytmusic/libraryFinder";

import { dislikedSongsNow, forgetDislikes, keepDislikes, loadDislikes } from "./dislikes";
import { currentFavoriteIds, knownStarNow, ytSongStarredNow } from "./favorites";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";
import { starSongs, type SongsToStar } from "./starSongs";

/**
 * Dislike (docs/spec.md): a mark that keeps a song out of what Wave picks on
 * its own. Core's `dislikeSongs` decides what it changes (a disliked song is
 * no favorite) and what Undo puts back; this writes it, for the Library's
 * songs and YT Music's alike. A song is one song under every key it has, its
 * Track id, the video it was downloaded from and the videos it is reached as:
 * it reads disliked under any of them, and removing its dislike forgets them
 * all. A new dislike is kept under Core's `dislikeKey`.
 */

/** A song to dislike: as its dislike is kept, and as its star is set. */
interface Subject {
  readonly dislike: Omit<DislikedSong, "dislikedAt">;
  readonly track: SongRow | null;
  readonly ytSong: NativeYtSong | null;
  /**
   * Everything it is told by: the Library's song with its own video, and the
   * videos it was passed as (a streamed song the Library has), which it may
   * be disliked under or playing as.
   */
  readonly identities: SongIdentity[];
}

const subjects = (
  { tracks, ytSongs }: SongsToStar,
  find: FindInLibrary,
  videoOf: ReadonlyMap<number, string>,
): Subject[] => {
  const byTrack = new Map<number, Subject>();
  const byVideo = new Map<string, Subject>();
  const addTrack = (track: SongRow, videoId?: string): void => {
    const known = byTrack.get(track.id);
    if (known !== undefined) {
      if (videoId !== undefined) known.identities.push({ videoId });
      return;
    }
    const identity = { id: track.id, videoId: videoOf.get(track.id) };
    byTrack.set(track.id, {
      dislike: {
        key: dislikeKey(identity) ?? String(track.id),
        title: track.title,
        artists: splitCredit(track.artist),
        durationMs: track.durationMs,
      },
      track,
      ytSong: null,
      identities: videoId === undefined ? [identity] : [identity, { videoId }],
    });
  };
  for (const track of tracks) addTrack(track);
  for (const ytSong of ytSongs) {
    const track = find(ytSong);
    if (track !== null) {
      addTrack(track, ytSong.videoId);
      continue;
    }
    const identity = { videoId: ytSong.videoId };
    const key = dislikeKey(identity);
    if (key === null || byVideo.has(key)) continue;
    byVideo.set(key, {
      dislike: {
        key,
        title: ytSong.title,
        artists: ytSong.artists,
        durationMs: ytSong.durationMs,
      },
      track: null,
      ytSong,
      identities: [identity],
    });
  }
  return [...byTrack.values(), ...byVideo.values()];
};

/** The video each Library song among [songs] was downloaded from, by Track id. */
const trackVideos = (
  { tracks, ytSongs }: SongsToStar,
  find: FindInLibrary,
): Promise<ReadonlyMap<number, string>> => {
  const ids = [
    ...new Set([
      ...tracks.map((track) => track.id),
      ...ytSongs.flatMap((song) => find(song)?.id ?? []),
    ]),
  ];
  if (ids.length === 0) return Promise.resolve(new Map());
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  return appRuntime.runPromise(LibraryStore.use((store) => store.videoIds(ids)));
};

/** The Library songs' stars, read from the store only when this phone doesn't know one yet. */
const starredTracks = async (songs: readonly Subject[]): Promise<(id: number) => boolean> => {
  const unknown = songs.some(({ track }) => track !== null && knownStarNow(track.id) === null);
  const read = unknown ? await currentFavoriteIds().catch(() => new Set<number>()) : null;
  return (id) => knownStarNow(id) ?? read?.has(id) ?? false;
};

/**
 * Writes [changes]: the dislikes, then the stars they replace or put back
 * (silently). The stars wait for the dislikes, so a dislike that fails to
 * save takes no star with it.
 */
const write = async (changes: MarkChanges<Subject>, find: FindInLibrary): Promise<void> => {
  const stars = (songs: readonly Subject[]): SongsToStar => ({
    tracks: songs.flatMap(({ track }) => (track === null ? [] : [track])),
    ytSongs: songs.flatMap(({ ytSong }) => (ytSong === null ? [] : [ytSong])),
  });
  await Promise.all([
    // Every key the song has: it may be kept under another than a new dislike takes.
    forgetDislikes(
      changes.removeDislike.flatMap(({ identities }) => identities.flatMap(dislikeKeys)),
    ),
    keepDislikes(
      changes.dislike.map((song) => song.dislike),
      changes.dislike.flatMap(({ identities }) =>
        identities.flatMap(({ id, videoId }) =>
          typeof id === "number" && typeof videoId === "string" ? [{ id, videoId }] : [],
        ),
      ),
    ),
  ]);
  await Promise.all([
    // Now Playing's source: the star changes without a toast of its own.
    changes.unfavorite.length === 0
      ? undefined
      : starSongs(stars(changes.unfavorite), false, find, "nowPlaying"),
    changes.favorite.length === 0
      ? undefined
      : starSongs(stars(changes.favorite), true, find, "nowPlaying"),
  ]);
};

/** Tells the owner a dislike, its removal or its Undo wasn't saved. */
export const dislikeFailed = (error: unknown): void => {
  void showError(currentLocalisation().strings.playbackText.couldntUpdateTheSong, error);
};

/**
 * Dislikes ([on]) or removes the dislike of [songs], the Library's and YT
 * Music's ([find] says which YT Music songs the Library has). A dislike
 * unstars the song and is confirmed by a toast whose Undo puts back what was
 * there, the star included; removing one says nothing, as unstarring does.
 * Once the changes are saved, a dislike of the song that is playing skips to
 * the next one, in any queue, as the Next button does (Core's
 * `dislikeSkipsPlaying`); removing a dislike never skips, and Undo doesn't go
 * back to the song. Resolves after the save and the skip, and rejects when
 * the save failed: nothing is confirmed or skipped then, and the caller says
 * so (`dislikeFailed`).
 */
export const dislikeSongs = async (
  songs: SongsToStar,
  on: boolean,
  find: FindInLibrary,
): Promise<void> => {
  const targets = subjects(songs, find, await trackVideos(songs, find));
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
      disliked: song.identities.some((identity) => isDisliked(disliked, identity)),
    })),
    on,
  );
  if (noMarkChanges(changes)) return;
  await write(changes, find);
  showDislikeToast(on, changes.dislike.length, () => void write(undo, find).catch(dislikeFailed));
  if (!on) return;
  const playing = currentEntry(queueState.get())?.trackId ?? null;
  // By the Track id, its own video and the videos it was passed as: whichever it plays as.
  const set = changes.dislike.flatMap(({ identities }) => identities);
  if (dislikeSkipsPlaying(playing, set)) await skipToNext();
};

/**
 * Whether a YT Music song shows disliked: by its video, or as [track], the
 * Library song it is by now (Core's `isDisliked`).
 */
export const ytSongDislikedNow = (
  videoId: string,
  track: { readonly id: number } | null,
): boolean => isDisliked(dislikedSongsNow(), { id: track?.id, videoId });
