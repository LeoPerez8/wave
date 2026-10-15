import { persistedSetting } from "@/lib/persistedSetting";
import { WaveSoulseek, soulseekErrorCode } from "@/native/waveSoulseek";

/**
 * Download in best quality as a synced preference (docs/spec.md, "What
 * syncs"). The switch itself lives in the native module, which connects the
 * Soulseek account; this is the Wave account's copy of it: Settings sets it
 * once the native switch has moved, and one pulled from another phone moves
 * the native switch. Turned on that way while the Wave account has a Soulseek
 * account, the phone uses that one instead of making its own.
 */
const bestQuality = persistedSetting<boolean>({
  key: "settings.bestQuality",
  synced: true,
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
  onApplied: (on) => {
    void (on ? WaveSoulseek.turnOn() : WaveSoulseek.turnOff()).catch((error: unknown) =>
      // Offline, or Soulseek's server down: the switch stays as it was, and Settings shows it.
      console.warn(`[wave] Couldn't turn Download in best quality ${on ? "on" : "off"}`, {
        code: soulseekErrorCode(error),
      }),
    );
  },
});

/** Settings turned Download in best quality on or off here: the Wave account hears of it. */
export const setBestQuality = bestQuality.set;
