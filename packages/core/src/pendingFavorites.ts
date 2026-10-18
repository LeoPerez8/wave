/**
 * Pending favorites (docs/spec.md, "Importing playlists from a link", From
 * YT Music): the liked songs Also add to Favorites couldn't star because the
 * Library didn't have them. Each waits, kept on this phone, until the song
 * enters the Library (a download, any download, or a scan finding its file);
 * it's starred then, and the pending favorite is gone, so a star taken off
 * by hand later stays off.
 */

import { libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/**
 * A liked song waiting for the Library: its YouTube Music song (the video
 * id) and its recording, as `libraryFinder` matches a YT Music song to a
 * Library song (title, artists, length).
 */
export type PendingFavorite = Pick<YtSong, "videoId" | "title" | "artists" | "durationMs">;

/** [song] as a pending favorite keeps it. */
export const pendingFavorite = ({
  videoId,
  title,
  artists,
  durationMs,
}: PendingFavorite): PendingFavorite => ({ videoId, title, artists, durationMs });

/** A song just written to the Library, as settling sees it. */
export interface EnteringSong extends LibrarySongKey {
  readonly id: number;
  /** The YouTube Music video it was downloaded from; null for a scanned file or a Soulseek download. */
  readonly videoId: string | null;
}

/** What songs entering the Library settle (`settlePendingFavorites`). */
export interface SettledFavorites {
  /** The tracks that get their star, each once. */
  readonly star: readonly number[];
  /** The video ids of the pending favorites settled, which are kept no more. */
  readonly settled: readonly string[];
}

/**
 * Which of [pending] the [songs] just written to the Library (downloaded or
 * scanned) settle: one downloaded from a pending favorite's video is it,
 * whatever its tags say; any other is it when it's the recording, as
 * `libraryFinder` matches a YT Music song (title, a shared artist, length
 * within a few seconds), so another take settles nothing. A song liked
 * under two videos settles both and is starred once.
 */
export const settlePendingFavorites = (
  pending: readonly PendingFavorite[],
  songs: readonly EnteringSong[],
): SettledFavorites => {
  if (pending.length === 0 || songs.length === 0) return { star: [], settled: [] };
  const byVideo = new Map<string, EnteringSong>();
  for (const song of songs) if (song.videoId !== null) byVideo.set(song.videoId, song);
  const find = libraryFinder(songs);
  const star = new Set<number>();
  const settled: string[] = [];
  for (const favorite of pending) {
    const song = byVideo.get(favorite.videoId) ?? find(favorite);
    if (song === null) continue;
    star.add(song.id);
    settled.push(favorite.videoId);
  }
  return { star: [...star], settled };
};
