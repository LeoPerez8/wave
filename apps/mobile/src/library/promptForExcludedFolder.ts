import { currentLocalisation } from "@/localisation/localisation";
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
    await showMessage(
      currentLocalisation().strings.settings.waveIsScanning,
      currentLocalisation().strings.settings.youCanExcludeAFolderOnceThe,
    );
    return;
  }
  try {
    const choice = await chooseExcludedMusicFolder();
    switch (choice.kind) {
      case "outside":
        await showMessage(
          currentLocalisation().strings.settings.notInYourMusicFolders,
          currentLocalisation().strings.settings.waveOnlyShowsSongsFromYourMusic,
        );
        return;
      case "root":
        await showMessage(
          currentLocalisation().strings.settings.thisIsAMusicFolder,
          currentLocalisation().strings.settings.toStopWaveShowingItsSongsRemove,
        );
        return;
      case "covered":
        await showMessage(
          currentLocalisation().strings.settings.alreadyExcluded,
          currentLocalisation().strings.settings.folderIgnored(
            describeFolder(choice.by, currentLocalisation().strings).name,
          ),
        );
        return;
      case "unsupported":
        await showMessage(
          currentLocalisation().strings.settings.waveCantReadThisFolder,
          currentLocalisation().strings.settings.pickItFromYourPhonesStorageOr,
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
