import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Whether the Lyrics view shows lyrics translated into the phone's language
 * (docs/spec.md, "Lyrics translation"): off until its Translate button turns
 * it on, then on for every song, through restarts, until it's turned off.
 * Kept on this phone only.
 */
const translateLyrics = persistedSetting<boolean>({
  key: "settings.translateLyrics",
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
});

export const setLyricsTranslationOn = translateLyrics.set;

/** Whether translation is on; re-renders when the Translate button changes it. */
export const useLyricsTranslationOn = translateLyrics.useValue;
