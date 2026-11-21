import {
  recognizeTileFavorite,
  recognizeTileNotice,
  recognizeMatchResult,
  type RecognizeMatch,
  type RecognizeResult,
  type RecognizeTileFavorite,
} from "@wave/core";

import { currentLocalisation } from "@/localisation/localisation";
import { recognizeTile, recognizeTileFavorites, reportCardSession } from "@/native/waveRecognize";

import { libraryListQueries } from "@/library/hooks";
import { appRuntime } from "@/library/runtime";
import type { SongRow } from "@wave/client";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { saveToShazam } from "@/library/playlists";
import { appLog } from "@/log/appLog";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { resolveRecognitionSave } from "./resolveRecognitionSave";

import { hasMicrophone } from "./microphone";
import { recognizeDeps } from "./recognizeDeps";
import { currentRecognizedStarred, recognizedSong, starRecognized } from "./recognizedStar";
import { followRecognizeTile, trackCardSessions } from "./recognizeTile";
import { followRecognizeTileFavorites } from "./recognizeTileFavorite";

let following: ReturnType<typeof followRecognizeTile<SongRow, NativeYtSong>> | null = null;
let followingFavorites = false;

type Result = RecognizeResult<SongRow, NativeYtSong>;

/** The match notification's star button for [result], as the song's star reads now. */
const tileFavorite = async (result: Result): Promise<RecognizeTileFavorite | null> => {
  const song = recognizedSong(result);
  return recognizeTileFavorite(
    result,
    { ytMusic: ytMusicEnabled(), starred: song !== null && (await currentRecognizedStarred(song)) },
    currentLocalisation().strings,
  );
};

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
      favorite: tileFavorite,
    },
    (card) => recognizeTileNotice(card, currentLocalisation().strings),
  );
  startRecognizeTileFavorites();
};

/** Follows the match notification's star button, so a tap stars without opening Wave. */
const startRecognizeTileFavorites = (): void => {
  if (recognizeTileFavorites === null || followingFavorites) return;
  followingFavorites = true;
  followRecognizeTileFavorites<SongRow, NativeYtSong>(recognizeTileFavorites, {
    result: recognizeTileResult,
    // Only while the card would offer the star: a streamed song needs YT Music on.
    star: async (result, on) => {
      const song = recognizedSong(result);
      const offered = recognizeTileFavorite(result, { ytMusic: ytMusicEnabled(), starred: false });
      if (song !== null && offered !== null) await starRecognized(song, on, "notification");
    },
    favorite: tileFavorite,
    log: (level, line) => appLog(level, "WaveRecognize", line),
  });
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
