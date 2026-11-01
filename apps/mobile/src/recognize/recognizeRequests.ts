import { readRecognizeMatch } from "@wave/core";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useEffect } from "react";
import { AppState } from "react-native";

import { recognizeRequests, recognizeMatches } from "@/native/waveRecognize";

import { openRecognize, resumeRecognizeEntry } from "./RecognizeCard";
import { followRecognizeRequests, followRecognizeMatches } from "./recognizeEntry";

/** The root receives launches over whichever screen is open, once the Library is ready. */
export const useRecognizeRequests = (ready: boolean): void => {
  useEffect(() => {
    if (!ready || recognizeRequests === null) return;
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") resumeRecognizeEntry();
    });
    const stop = followRecognizeRequests(recognizeRequests, openRecognize);
    const stopMatches =
      recognizeMatches === null
        ? () => {}
        : followRecognizeMatches(recognizeMatches, (text) => {
            const match = readRecognizeMatch<NativeYtSong>(text);
            if (match !== null) openRecognize({ kind: "match", match });
          });
    resumeRecognizeEntry();
    return () => {
      stop();
      stopMatches();
      foreground.remove();
    };
  }, [ready]);
};
