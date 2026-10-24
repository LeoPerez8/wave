import { parseTrackId, readUnsearchedTrackId, type UnsearchedSong } from "@wave/core";

import type { NativeYtSong } from "../native/waveYtMusic.ts";
import { queuedYtSong, type QueueTrack } from "./queueTracks.ts";

/** Which song menu a queued song opens. */
export type SongMenuTarget =
  | { readonly kind: "library"; readonly id: number }
  | { readonly kind: "stream"; readonly song: NativeYtSong }
  | { readonly kind: "unsearched"; readonly song: UnsearchedSong };

/**
 * The usual song menu for the queued song [trackId], whose row metadata
 * [track] may not be loaded yet: shared by Up Next, History and the mini player.
 */
export const songMenuTarget = (
  trackId: string,
  track: QueueTrack | undefined,
): SongMenuTarget | null => {
  const ref = parseTrackId(trackId);
  if (ref?.kind === "library") return ref;
  if (ref?.kind === "yt" && track !== undefined) {
    const song = queuedYtSong(track);
    if (song !== null) return { kind: "stream", song };
  }
  const unsearched = readUnsearchedTrackId(trackId);
  return unsearched === null
    ? null
    : {
        kind: "unsearched",
        song: { ...unsearched, artworkUrl: track?.artworkPath ?? unsearched.artworkUrl },
      };
};
