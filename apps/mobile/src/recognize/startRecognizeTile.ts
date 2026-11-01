import { recognizeTileNotice } from "@wave/core";

import { currentLocalisation } from "@/localisation/localisation";
import { recognizeTile, reportCardSession } from "@/native/waveRecognize";

import { hasMicrophone } from "./microphone";
import { recognizeDeps } from "./recognizeDeps";
import { followRecognizeTile, trackCardSessions } from "./recognizeTile";

let following: ReturnType<typeof followRecognizeTile> | null = null;

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
      microphone: async () => ((await hasMicrophone()) ? "granted" : "denied"),
    },
    (card) => recognizeTileNotice(card, currentLocalisation().strings),
  );
};

/** Ends a tile session still listening, with no result. */
export const cancelRecognizeTile = (): void => following?.cancel();

export const trackCardSession = trackCardSessions(reportCardSession);
