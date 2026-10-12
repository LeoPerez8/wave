import { describeFolder } from "@wave/core";

import { showError, showMessage } from "@/overlay/alert";

import { scanState } from "./LibraryScan";
import { chooseMusicFolder } from "./runtime";

/**
 * Opens the system folder picker and adds the folder, explaining picks that
 * add nothing. Folders can't change while a scan runs.
 */
export const promptForMusicFolder = async (): Promise<void> => {
  if (scanState.get().status === "scanning") {
    await showMessage("Wave is scanning", "You can add a folder once the scan finishes.");
    return;
  }
  try {
    const choice = await chooseMusicFolder();
    if (choice.kind === "covered") {
      await showMessage(
        "Already in your library",
        `Wave already shows the songs in ${describeFolder(choice.by).name}, which includes this folder.`,
      );
    } else if (choice.kind === "unsupported") {
      await showMessage(
        "Wave can't read this folder",
        "Pick it from your phone's storage or SD card in the picker, rather than from a shortcut like Downloads or a cloud drive.",
      );
    }
  } catch (error) {
    await showError("Couldn't add the folder", error);
  }
};
