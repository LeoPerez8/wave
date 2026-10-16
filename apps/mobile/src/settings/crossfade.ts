import { crossfadeDuration, readCrossfade, snapCrossfade } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { WavePlayer } from "@/native/wavePlayer";

export { CROSSFADE } from "@wave/core";

/**
 * Tells the playback service how long songs ending on their own overlap (Core's
 * `crossfadeDuration`). The service skips the overlap where there's none to
 * play: repeat one, the last song, an end-of-song sleep timer.
 */
const send = (seconds: number): void => {
  WavePlayer.setCrossfadeDuration(crossfadeDuration(seconds)).catch((error: unknown) =>
    console.warn("[wave] Couldn't apply crossfade", error),
  );
};

/** Crossfade (Settings › Playback), in seconds; 0 is off, gapless. */
const crossfade = persistedSetting<number>({
  key: "settings.crossfadeSeconds",
  synced: true,
  read: readCrossfade,
  write: String,
  persistDelayMs: 300,
  onValue: send,
});

/** Hands the playback service the stored crossfade at start (headless Auto too). */
export const applyCrossfade = (): void => {
  crossfade.get();
};

export const useCrossfadeSeconds = crossfade.useValue;

export const setCrossfadeSeconds = (value: number): void => crossfade.set(snapCrossfade(value));
