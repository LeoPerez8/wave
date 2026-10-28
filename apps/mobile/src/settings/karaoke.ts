import { persistedSetting } from "@/lib/persistedSetting";

/** Karaoke follows songs and restarts on this phone; it is never synced. */
const karaoke = persistedSetting<boolean>({
  key: "settings.karaoke",
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
});

export const setKaraokeOn = karaoke.set;
export const useKaraokeOn = karaoke.useValue;
