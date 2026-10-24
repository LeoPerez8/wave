import { parseTrackId, readUnsearchedTrackId, type UnsearchedSong } from "@wave/core";

import type { NativeYtSong } from "../native/waveYtMusic.ts";
import { queuedYtSong, type QueueTrack } from "../playback/queueTracks.ts";

type QueueSongMenuTarget =
  | { readonly kind: "library"; readonly id: number }
  | { readonly kind: "stream"; readonly song: NativeYtSong }
  | { readonly kind: "unsearched"; readonly song: UnsearchedSong };

/** The usual song menu for a queue row, shared by Up Next and History. */
export const queueSongMenuTarget = (
  trackId: string,
  track: QueueTrack | undefined,
): QueueSongMenuTarget | null => {
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
