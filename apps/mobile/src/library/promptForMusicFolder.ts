import { currentLocalisation } from "@/localisation/localisation";
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
    await showMessage(
      currentLocalisation().strings.settings.waveIsScanning,
      currentLocalisation().strings.settings.youCanAddAFolderOnceThe,
    );
    return;
  }
  try {
    const choice = await chooseMusicFolder();
    if (choice.kind === "covered") {
      await showMessage(
        currentLocalisation().strings.settings.alreadyInYourLibrary,
        currentLocalisation().strings.settings.folderCovered(
          describeFolder(choice.by, currentLocalisation().strings).name,
        ),
      );
    } else if (choice.kind === "unsupported") {
      await showMessage(
        currentLocalisation().strings.settings.waveCantReadThisFolder,
        currentLocalisation().strings.settings.pickItFromYourPhonesStorageOr,
      );
    }
  } catch (error) {
    await showError("Couldn't add the folder", error);
  }
};
