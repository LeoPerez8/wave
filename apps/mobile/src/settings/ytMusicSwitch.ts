/**
 * Settings › Accounts › YT Music's Use YT Music switch (docs/spec.md, YT
 * Music › Off switch). Turning it off on this phone asks first, saying what
 * stops (Core's `confirmYtMusicOff`), with a line that every phone of the
 * Wave account turns it off too while one is signed in, as the setting syncs.
 * Turning it on asks nothing, and a value pulled from another phone
 * (`applySyncedSetting`) never comes through here.
 */
import { confirmYtMusicOff } from "@wave/core";

import { currentLocalisation } from "@/localisation/localisation";
import { confirmAction } from "@/overlay/alert";
import { waveSignedIn } from "@/sync/waveSignedIn";

import { setYtMusicEnabled } from "./ytMusic";

/** The switch moved to [on]: on at once; off once the warning's Turn Off is chosen. */
export const switchYtMusic = async (on: boolean): Promise<void> => {
  if (on) {
    setYtMusicEnabled(true);
    return;
  }
  const alert = confirmYtMusicOff(await waveSignedIn(), currentLocalisation().strings);
  if (await confirmAction(alert)) setYtMusicEnabled(false);
};
