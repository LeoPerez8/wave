import { readNormalizeVolume, writeNormalizeVolume } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { WavePlayer } from "@/native/wavePlayer";

/**
 * Tells the playback service whether songs play at their leveled gain (Core's
 * `songGain`). It applies at once, to the song playing too, without a skip or
 * a pause.
 */
const send = (on: boolean): void => {
  WavePlayer.setNormalizeVolume(on).catch((error: unknown) =>
    console.warn("[wave] Couldn't apply Normalize Volume", error),
  );
};

/** Normalize Volume (Settings › Playback), on unless the owner turned it off. */
const normalizeVolumeSetting = persistedSetting<boolean>({
  key: "settings.normalizeVolume",
  synced: true,
  read: readNormalizeVolume,
  write: writeNormalizeVolume,
  onValue: send,
});

/** Hands the playback service the stored switch at start (headless Auto too). */
export const applyNormalizeVolume = (): void => {
  normalizeVolumeSetting.get();
};

export const setNormalizeVolume = normalizeVolumeSetting.set;

/** Whether Normalize Volume is on; re-renders when Settings changes it. */
export const useNormalizeVolume = normalizeVolumeSetting.useValue;
