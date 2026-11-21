import {
  nowPlayingEditHintDue,
  readNowPlayingEditHintShown,
  storedNowPlayingEditHintShown,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { showToast } from "@/overlay/toast";

/**
 * Whether Now Playing's edit hint showed on this phone. Kept on the device
 * only: it never syncs with the Wave account.
 */
const hintShown = persistedSetting<boolean>({
  key: "nowPlaying.editHintShown",
  read: readNowPlayingEditHintShown,
  write: storedNowPlayingEditHintShown,
});

/**
 * Shows the toast that says a held button edits Now Playing, the first time
 * Now Playing opens on this phone ([nowPlayingOpen]) and never again (Core's
 * `nowPlayingEditHintDue`).
 */
export const showNowPlayingEditHint = (nowPlayingOpen: boolean): void => {
  if (!nowPlayingEditHintDue({ nowPlayingOpen, shown: hintShown.get() })) return;
  hintShown.set(true);
  void showToast(currentLocalisation().strings.playbackText.holdAButtonToEditThisScreen);
};
