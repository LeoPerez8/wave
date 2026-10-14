import { persistedSetting } from "@/lib/persistedSetting";
import { WaveYtMusic } from "@/native/waveYtMusic";

/**
 * Whether Wave uses YT Music (on unless the owner turned it off). The native
 * side keeps its own copy, so it refuses requests while off even where JS
 * doesn't ask first (the playback service).
 */
const ytMusic = persistedSetting<boolean>({
  key: "settings.ytMusic",
  synced: true,
  read: (stored) => stored !== "off",
  write: (on) => (on ? null : "off"),
  onValue: (on) => WaveYtMusic.setEnabled(on),
});

export const ytMusicEnabled = ytMusic.get;

export const setYtMusicEnabled = ytMusic.set;

/** Whether YT Music is on; re-renders when Settings changes it. */
export const useYtMusicEnabled = ytMusic.useValue;
