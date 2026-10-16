import { CROSSFADE, crossfadeDuration } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { WavePlayer } from "@/native/wavePlayer";

const crossfade = persistedSetting<number>({
  key: "settings.crossfadeSeconds",
  synced: true,
  read: (stored) => crossfadeDuration(stored === null ? CROSSFADE.default : Number(stored), "natural", null) / 1000,
  write: String,
  persistDelayMs: 300,
  onValue: (seconds) => {
    WavePlayer.setCrossfadeDuration(crossfadeDuration(seconds, "natural", null)).catch((error: unknown) =>
      console.warn("[wave] Couldn't apply crossfade", error),
    );
  },
});

/** Applies the persisted policy before the player starts, including headless Auto. */
export const applyCrossfade = crossfade.get;
export const useCrossfadeSeconds = crossfade.useValue;
export const setCrossfadeSeconds = (seconds: number): void =>
  crossfade.set(crossfadeDuration(seconds, "natural", null) / 1000);
