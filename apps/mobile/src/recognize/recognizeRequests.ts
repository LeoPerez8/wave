import { useEffect } from "react";
import { AppState } from "react-native";

import { recognizeRequests } from "@/native/waveRecognize";

import { openRecognize, resumeRecognizeEntry } from "./RecognizeCard";
import { followRecognizeRequests } from "./recognizeEntry";

/** The root receives launches over whichever screen is open, once the Library is ready. */
export const useRecognizeRequests = (ready: boolean): void => {
  useEffect(() => {
    if (!ready || recognizeRequests === null) return;
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") resumeRecognizeEntry();
    });
    const stop = followRecognizeRequests(recognizeRequests, openRecognize);
    resumeRecognizeEntry();
    return () => {
      stop();
      foreground.remove();
    };
  }, [ready]);
};
