import { crossfadeDuration, readCrossfade, snapCrossfade } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { WavePlayer } from "@/native/wavePlayer";
import { sleepTimerState } from "@/playback/Player";

export { CROSSFADE } from "@wave/core";

let seconds: number | null = null;

/**
 * Tells the playback service how long songs ending on their own overlap
 * (Core's `crossfadeDuration`): none while an end-of-song sleep timer waits,
 * which stops after the song with nothing of the next one.
 */
const send = (): void => {
  if (seconds === null) return;
  WavePlayer.setCrossfadeDuration(
    crossfadeDuration(seconds, "natural", sleepTimerState.get()),
  ).catch((error: unknown) => console.warn("[wave] Couldn't apply crossfade", error));
};

/** Crossfade (Settings › Playback), in seconds; 0 is off, gapless. */
const crossfade = persistedSetting<number>({
  key: "settings.crossfadeSeconds",
  synced: true,
  read: readCrossfade,
  write: String,
  persistDelayMs: 300,
  onValue: (value) => {
    seconds = value;
    send();
  },
});

let followingSleepTimer = false;

/**
 * Hands the playback service the stored crossfade at start (headless Auto
 * too), and again whenever the sleep timer changes.
 */
export const applyCrossfade = (): void => {
  crossfade.get();
  if (followingSleepTimer) return;
  followingSleepTimer = true;
  sleepTimerState.subscribe(send);
};

export const useCrossfadeSeconds = crossfade.useValue;

export const setCrossfadeSeconds = (value: number): void => crossfade.set(snapCrossfade(value));
