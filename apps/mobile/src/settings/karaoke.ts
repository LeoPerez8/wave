import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Whether the Lyrics view lights the sung line word by word (docs/spec.md,
 * "Karaoke"): off until its Karaoke button turns it on, then on for every
 * song, through restarts, until it's turned off. Kept on this phone only.
 */
const karaoke = persistedSetting<boolean>({
  key: "settings.karaoke",
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
});

export const setKaraokeOn = karaoke.set;

/** Whether Karaoke is on; re-renders when the Karaoke button changes it. */
export const useKaraokeOn = karaoke.useValue;
