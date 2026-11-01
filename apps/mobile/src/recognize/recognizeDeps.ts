import { AppState } from "react-native";

import { libraryListQueries } from "@/library/hooks";
import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { appLog } from "@/log/appLog";
import { online } from "@/native/waveNative";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { holdPlayback } from "@/playback/holdPlayback";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { searchSongsInTurn } from "@/ytmusic/askYtMusic";

import { microphonePermission } from "./microphone";
import type { RecognizeDeps, RecognizeNative } from "./recognizeSession";
import { resolveRecognition } from "./resolveRecognition";

/** What a Recognize session runs on, from the card or the tile. */
export const recognizeDeps = (native: RecognizeNative): RecognizeDeps<SongRow, NativeYtSong> => ({
  online,
  foreground: () => AppState.currentState === "active",
  now: () => performance.now(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  },
  microphone: microphonePermission,
  holdPlayback,
  native,
  resolve: (song, signal) =>
    resolveRecognition(
      {
        library: () => appRuntime.runPromise(libraryListQueries.songs.read),
        ytMusic: ytMusicEnabled,
        search: searchSongsInTurn,
      },
      song,
      signal,
    ),
  log: (level, line) => appLog(level, "WaveRecognize", line),
});
