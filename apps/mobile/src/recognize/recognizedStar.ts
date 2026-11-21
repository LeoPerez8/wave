import { ytSongStarred, type FavoriteSource, type RecognizeResult } from "@wave/core";
import type { SongRow } from "@wave/client";

import {
  currentFavoriteIds,
  currentPendingFavoriteVideos,
  useLiveFavoriteIds,
  useLivePendingFavoriteVideos,
} from "@/library/favorites";
import { starSongs } from "@/library/starSongs";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { currentLibraryFinder, useLibraryFinder } from "@/ytmusic/libraryFinder";

/**
 * The song a recognized or looked-up result plays (Recognize's card and tile, a Genius
 * result's menu): the Library's track, or YT Music's song.
 */
export type RecognizedSong =
  | { readonly source: "library"; readonly track: SongRow }
  | { readonly source: "stream"; readonly song: NativeYtSong };

/** What [result] plays, or null when it has no song Wave can play. */
export const recognizedSong = (
  result: RecognizeResult<SongRow, NativeYtSong> | null,
): RecognizedSong | null =>
  result?.kind === "library"
    ? { source: "library", track: result.track }
    : result?.kind === "stream"
      ? { source: "stream", song: result.song }
      : null;

/**
 * Whether [song] shows starred, following its star: the Library track's, or for a YT Music
 * song its pending favorite or the star of the Library song it is by now (`ytSongStarred`).
 */
export const useRecognizedStarred = (song: RecognizedSong | null): boolean => {
  const streamed = song?.source === "stream";
  const favoriteIds = useLiveFavoriteIds(song !== null);
  const pending = useLivePendingFavoriteVideos(streamed);
  const find = useLibraryFinder(streamed);
  if (song === null) return false;
  if (song.source === "library") return favoriteIds.has(song.track.id);
  return ytSongStarred(song.song.videoId, find(song.song), favoriteIds, pending);
};

/** `useRecognizedStarred` read afresh from the store, outside any screen. */
export const currentRecognizedStarred = async (song: RecognizedSong): Promise<boolean> => {
  if (song.source === "library") return (await currentFavoriteIds()).has(song.track.id);
  const [favoriteIds, pending, find] = await Promise.all([
    currentFavoriteIds(),
    currentPendingFavoriteVideos(),
    currentLibraryFinder(),
  ]);
  return ytSongStarred(song.song.videoId, find(song.song), favoriteIds, pending);
};

/**
 * Stars ([on]) or unstars [song] (`starSongs`): a YT Music song the Library doesn't have
 * becomes a pending favorite and its download joins the queue. Never adds it to Shazam.
 */
export const starRecognized = async (
  song: RecognizedSong,
  on: boolean,
  source: FavoriteSource,
): Promise<void> => {
  if (song.source === "library")
    return starSongs({ tracks: [song.track], ytSongs: [] }, on, () => null, source);
  return starSongs({ tracks: [], ytSongs: [song.song] }, on, await currentLibraryFinder(), source);
};
