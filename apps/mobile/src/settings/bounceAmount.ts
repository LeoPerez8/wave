import { readBounceAmount, storedBounceAmount } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Settings › Appearance › Motion › Bounce amount, in percent (0–120, 100 by
 * default): how elastic pulls and swipes are. Core reads what's stored
 * (nothing or anything malformed is 100%, off-range values are clamped) and
 * stores nothing at the default, so it syncs as unset.
 */
const bounceAmount = persistedSetting<number>({
  key: "settings.bounceAmount",
  synced: true,
  read: readBounceAmount,
  write: storedBounceAmount,
  // Writes wait until a drag settles, so a slider doesn't hit storage every frame.
  persistDelayMs: 300,
});

/** Changes the bounce amount; every pull and swipe follows at once. */
export const setBounceAmount = (amount: number): void =>
  // Read back through Core so the value lands on the slider's range and step.
  bounceAmount.set(readBounceAmount(String(amount)));

/** The persisted bounce amount; re-renders when Settings changes it. */
export const useBounceAmount = bounceAmount.useValue;
