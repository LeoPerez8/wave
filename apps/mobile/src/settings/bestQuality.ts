import { settleBestQuality, type BestQualityStep } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";

import { persistedSetting, stampSyncedSetting } from "@/lib/persistedSetting";
import { WaveSoulseek, soulseekErrorCode } from "@/native/waveSoulseek";

const KEY = "settings.bestQuality";

/**
 * Set while a value pulled from the Wave account waits for the native switch
 * to follow it, across launches: a pulled on that couldn't turn the switch on
 * offline is tried again at the next pull, never taken for one that went off.
 */
const PULLED = "settings.bestQuality.pulled";

/**
 * Download in best quality as a synced preference (docs/spec.md, "What
 * syncs"). The switch itself lives in the native module, which connects the
 * Soulseek account; this is the Wave account's copy of it: Settings sets it
 * once the native switch has moved, and one pulled from another phone moves
 * the native switch at the end of the pull (`followPulledBestQuality`).
 * Turned on that way while the Wave account has a Soulseek account, the phone
 * uses that one instead of making its own.
 */
const bestQuality = persistedSetting<boolean>({
  key: KEY,
  synced: true,
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
  onApplied: () => Storage.setItemSync(PULLED, "1"),
});

/**
 * Settings turned Download in best quality on or off here: the Wave account
 * hears of it, even when the synced copy already said so (a phone from before
 * the switch shows it on over a copy it never set).
 */
export const setBestQuality = (on: boolean): void => {
  Storage.removeItemSync(PULLED);
  if (bestQuality.get() === on) stampSyncedSetting(KEY);
  else bestQuality.set(on);
};

/**
 * After each pull: the native switch follows a pulled value it doesn't show
 * yet, and a switch that went off natively (Soulseek rejected the account)
 * turns the synced copy off (Core's `settleBestQuality`). Never rejects.
 */
export const followPulledBestQuality = async (): Promise<void> => {
  let step: BestQualityStep = "none";
  try {
    const session = await WaveSoulseek.session();
    step = settleBestQuality({
      synced: bestQuality.get(),
      native: session.status !== "off",
      pulled: Storage.getItemSync(PULLED) !== null,
    });
    if (step === "applied") Storage.removeItemSync(PULLED);
    if (step === "wentOff") bestQuality.set(false);
    if (step !== "turnOn" && step !== "turnOff") return;
    const on = step === "turnOn";
    await (on ? WaveSoulseek.turnOn() : WaveSoulseek.turnOff());
    // Unless a newer value came meanwhile, which the next pull follows.
    if (bestQuality.get() === on) Storage.removeItemSync(PULLED);
  } catch (error: unknown) {
    // Offline, or Soulseek's server down: the switch stays as it was, and the next pull tries again.
    console.warn(`[wave] Couldn't settle Download in best quality (${step})`, {
      code: soulseekErrorCode(error),
    });
  }
};
