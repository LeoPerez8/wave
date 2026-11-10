import { songLinkHandling, type SongLinkHandling } from "@wave/core";

import { WaveNative } from "@/native/waveNative";

/** Which song links Android lets Wave open; null on an APK without the native read. */
export const readSongLinkHandling = (): SongLinkHandling | null => {
  const state = WaveNative.songLinkHandling?.();
  return state ? songLinkHandling(state) : null;
};
