import { recognizeTileNotice, recognizeMatchResult, type RecognizeMatch } from "@wave/core";

import { currentLocalisation } from "@/localisation/localisation";
import { recognizeTile, reportCardSession } from "@/native/waveRecognize";

import { libraryListQueries } from "@/library/hooks";
import { appRuntime } from "@/library/runtime";
import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { saveToShazam } from "@/library/playlists";
import { resolveRecognitionSave } from "./resolveRecognitionSave";

import { hasMicrophone } from "./microphone";
import { recognizeDeps } from "./recognizeDeps";
import { followRecognizeTile, trackCardSessions } from "./recognizeTile";

let following: ReturnType<typeof followRecognizeTile<SongRow, NativeYtSong>> | null = null;

/**
 * Follows the tile from the app services, so a tap finds JS however it started. There's
 * no screen to ask for the microphone on: without it the session ends as denied.
 */
export const startRecognizeTile = (): void => {
  if (recognizeTile === null || following !== null) return;
  following = followRecognizeTile(
    recognizeTile,
    {
      ...recognizeDeps(recognizeTile.capture),
      library: () => appRuntime.runPromise(libraryListQueries.songs.read),
      couldntSave: () => currentLocalisation().strings.playbackText.couldntAddToShazam,
      save: async (result) => saveToShazam(await resolveRecognitionSave(result)),
      microphone: async () => ((await hasMicrophone()) ? "granted" : "denied"),
    },
    (card) => recognizeTileNotice(card, currentLocalisation().strings),
  );
};

/** Ends a tile session still listening, with no result. */
export const cancelRecognizeTile = (): void => following?.cancel();

export const trackCardSession = trackCardSessions(reportCardSession);

/** Reuses a live lookup, or reads the notification's kept answer without searching. */
export const recognizeTileResult = async (match: RecognizeMatch<NativeYtSong>) => {
  startRecognizeTile();
  if (following !== null) return following.result(match);
  const library = await appRuntime.runPromise(libraryListQueries.songs.read).catch(() => []);
  return recognizeMatchResult(match, library);
};
