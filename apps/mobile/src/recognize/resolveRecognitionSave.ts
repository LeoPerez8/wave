import { recognizePlaylistSong, type RecognizeResult } from "@wave/core";

import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { currentLibraryFinder } from "@/ytmusic/libraryFinder";

/** Rechecks downloads at save time for both the card and the tile's automatic save. */
export const resolveRecognitionSave = async (result: RecognizeResult<SongRow, NativeYtSong>) => {
  const track = result.kind === "stream" ? (await currentLibraryFinder())(result.song) : null;
  return track === null
    ? recognizePlaylistSong(result)
    : ({ source: "library", trackId: track.id } as const);
};
