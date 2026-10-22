import { ytTrackId, type YtSong } from "./ytMusic.ts";

/**
 * The current recording's row identities, without changing the queue or
 * player. A stream retains its online identity and gains its Library row
 * when the shared recording finder sees the completed download. Stale song
 * metadata from a previous queue entry cannot mark that entry's Library row.
 */
export const playingTrackIds = (
  currentId: string | null,
  song: YtSong | null,
  find: (song: YtSong) => { readonly id: number } | null,
): readonly string[] => {
  if (currentId === null) return [];
  const downloaded = song !== null && currentId === ytTrackId(song.videoId) ? find(song) : null;
  return downloaded === null ? [currentId] : [currentId, String(downloaded.id)];
};
