/**
 * Disliking the song that is playing skips to the next one, in any queue, as
 * the Next button does (docs/spec.md, story 55b). Removing a dislike never
 * skips: the app asks this only for the songs a dislike was just set on.
 */

import { dislikeKeys, type SongIdentity } from "./dislikes.ts";

/**
 * Whether the song playing, queue track [playingTrackId], is one of the songs
 * just disliked ([disliked]): by its Library Track id or by its video, since a
 * streamed song the Library has is disliked as the Library's song.
 */
export const dislikeSkipsPlaying = (
  playingTrackId: string | null,
  disliked: readonly SongIdentity[],
): boolean =>
  playingTrackId !== null && disliked.some((song) => dislikeKeys(song).includes(playingTrackId));
