import { describeFolder } from "@wave/core";

import { showError, showMessage } from "@/overlay/alert";

import { scanState } from "./LibraryScan";
import { chooseExcludedMusicFolder } from "./runtime";

/**
 * Opens the system folder picker and excludes the folder, explaining picks
 * that can't be excluded. Folders can't change while a scan runs.
 */
export const promptForExcludedFolder = async (): Promise<void> => {
  if (scanState.get().status === "scanning") {
    await showMessage("Wave is scanning", "You can exclude a folder once the scan finishes.");
    return;
  }
  try {
    const choice = await chooseExcludedMusicFolder();
    switch (choice.kind) {
      case "outside":
        await showMessage(
          "Not in your music folders",
          "Wave only shows songs from your music folders, so there's nothing to exclude here.",
        );
        return;
      case "root":
        await showMessage(
          "This is a music folder",
          "To stop Wave showing its songs, remove it from your music folders instead.",
        );
        return;
      case "covered":
        await showMessage(
          "Already excluded",
          `Wave already ignores ${describeFolder(choice.by).name}, which includes this folder.`,
        );
        return;
      case "unsupported":
        await showMessage(
          "Wave can't read this folder",
          "Pick it from your phone's storage or SD card in the picker, rather than from a shortcut like Downloads or a cloud drive.",
        );
        return;
      case "added":
      case "cancelled":
        return;
    }
  } catch (error) {
    await showError("Couldn't exclude the folder", error);
  }
};
